<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bookings.php';

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function sampleBooking(string $contact = 'customer@example.test'): array
{
    return validateBooking(['bookingType' => 'Table reservation',
        'date' => (new DateTimeImmutable('next monday', new DateTimeZone('Asia/Manila')))->format('Y-m-d'),
        'time' => '12:00', 'guests' => '1–2', 'name' => 'Test Customer',
        'contact' => $contact, 'consent' => 'yes', 'notes' => 'No real email is sent.']);
}
function countEmails(PDO $db): int
{
    return (int) $db->query('SELECT COUNT(*) FROM email_outbox')->fetchColumn();
}

putenv('CASA_MAIL_FROM=noreply@example.test');
putenv('CASA_OWNER_EMAIL=owner@example.test');
putenv('CASA_MAIL_MODE=off');
$db = bookingDatabase(':memory:');
saveBooking($db, sampleBooking(), 'local-test');
check(countEmails($db) === 0, 'Disabled mode must not enqueue email.');

putenv('CASA_MAIL_MODE=preview');
$db = bookingDatabase(':memory:');
$booking = sampleBooking();
$saved = saveBooking($db, $booking, 'local-test');
check(countEmails($db) === 2, 'New email booking must queue owner alert and customer receipt.');
saveBooking($db, $booking, 'local-test');
check(countEmails($db) === 2, 'Duplicate submissions must not queue another email.');
$receipt = $db->query("SELECT body FROM email_outbox WHERE recipient = 'customer@example.test'")->fetchColumn();
check(str_contains($receipt, 'not a confirmed reservation'), 'Receipt must distinguish pending from confirmed.');
changeBookingStatus($db, $saved['id'], 'confirmed');
check(countEmails($db) === 3, 'Confirmation must queue a customer update.');
changeBookingStatus($db, $saved['id'], 'confirmed');
check(countEmails($db) === 3, 'Unchanged status must not queue email.');
changeBookingStatus($db, $saved['id'], 'cancelled');
check(countEmails($db) === 4, 'Cancellation must queue a customer update.');
$results = processEmailQueue($db, function () { throw new RuntimeException('Preview must never invoke transport.'); });
check($results['previewed'] === 4, 'Preview worker should mark messages without sending.');
putenv('CASA_MAIL_MODE=mail');
$called = false;
processEmailQueue($db, function () use (&$called) { $called = true; return true; });
check(!$called, 'Preview messages must never become live emails.');

$db = bookingDatabase(':memory:');
$phone = saveBooking($db, sampleBooking('+639123456789'), 'local-test');
check(countEmails($db) === 1, 'Phone-only booking should notify only the owner.');
changeBookingStatus($db, $phone['id'], 'confirmed');
check(countEmails($db) === 1, 'Phone-only customer must not receive email.');
for ($attempt = 1; $attempt <= 5; $attempt++) {
    $db->exec('UPDATE email_outbox SET next_attempt = 0');
    $result = processEmailQueue($db, fn() => false);
    check($result[$attempt === 5 ? 'failed' : 'retrying'] === 1, 'Failed sends must retry with an eventual failure state.');
}
check((int) $db->query('SELECT COUNT(*) FROM bookings')->fetchColumn() === 1, 'Email failures must not delete the booking.');
check((int) $db->query('SELECT attempts FROM email_outbox')->fetchColumn() === 5, 'Retry count must be bounded.');

$db = bookingDatabase(':memory:');
$saved = saveBooking($db, sampleBooking(), 'local-test');
changeBookingStatus($db, $saved['id'], 'confirmed');
$seen = [];
$accepted = processEmailQueue($db, function ($email) use (&$seen) { $seen[] = $email; return true; });
check($accepted['accepted'] === 3, 'Transport acceptance must be persisted.');
check(str_contains($seen[1]['body'], 'Status: pending') && str_contains($seen[2]['body'], 'Status: confirmed'), 'Customer emails must retain event order.');
check(processEmailQueue($db, fn() => true)['accepted'] === 0, 'Accepted messages must not resend.');

$db = bookingDatabase(':memory:');
saveBooking($db, sampleBooking('+639123456789'), 'local-test');
$db->exec("UPDATE email_outbox SET state = 'processing', attempts = 5, locked_until = 0");
processEmailQueue($db, fn() => true);
check($db->query('SELECT state FROM email_outbox')->fetchColumn() === 'failed', 'Final expired leases must not remain stuck.');

$db = bookingDatabase(':memory:');
saveBooking($db, sampleBooking('+639123456789'), 'local-test');
$db->exec("UPDATE email_outbox SET state = 'processing', attempts = 1, locked_until = " . (time() + 900));
check(processEmailQueue($db, fn() => true)['accepted'] === 0, 'Another worker must not claim an active lease.');
$db->exec('UPDATE email_outbox SET locked_until = 0');
check(processEmailQueue($db, fn() => true)['accepted'] === 1, 'Expired leases should be recoverable.');

$db = bookingDatabase(':memory:');
putenv("CASA_MAIL_FROM=bad\r\nBcc: attacker@example.test");
try {
    saveBooking($db, sampleBooking(), 'local-test');
    throw new RuntimeException('Expected invalid configuration to reject the transaction.');
} catch (RuntimeException $error) {
    check(str_contains($error->getMessage(), 'Configure valid'), 'Invalid sender must be rejected.');
}
check((int) $db->query('SELECT COUNT(*) FROM bookings')->fetchColumn() === 0, 'Booking and queue must commit atomically.');
echo "Email queue checks passed (no real mail sent).\n";
