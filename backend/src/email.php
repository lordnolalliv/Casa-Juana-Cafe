<?php
declare(strict_types=1);

function emailConfig(): array
{
    $mode = getenv('CASA_MAIL_MODE') ?: 'off';
    $from = getenv('CASA_MAIL_FROM') ?: '';
    $owner = getenv('CASA_OWNER_EMAIL') ?: '';
    if (!in_array($mode, ['off', 'preview', 'mail'], true)) {
        throw new RuntimeException('Invalid email mode.');
    }
    if ($mode !== 'off') {
        foreach ([$from, $owner] as $address) {
            if (!filter_var($address, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $address)) {
                throw new RuntimeException('Configure valid sender and owner email addresses.');
            }
        }
    }
    return compact('mode', 'from', 'owner');
}

function createEmailSchema(PDO $db): void
{
    $db->exec("CREATE TABLE IF NOT EXISTS email_outbox (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, recipient TEXT NOT NULL,
        sender TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
        mode TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL,
        locked_until INTEGER NOT NULL DEFAULT 0, claim TEXT,
        created_at INTEGER NOT NULL, accepted_at INTEGER, last_error TEXT)");
    $db->exec('CREATE INDEX IF NOT EXISTS email_ready ON email_outbox(state, next_attempt)');
    $db->exec('CREATE INDEX IF NOT EXISTS email_booking ON email_outbox(booking_id)');
}

// Called inside the same transaction as the booking change.
function queueBookingEmails(PDO $db, array $booking, string $event): int
{
    $config = emailConfig();
    if ($config['mode'] === 'off') return 0;
    $summary = "Reference: {$booking['id']}\nBooking: {$booking['booking_type']}\n"
        . "Date: {$booking['date']}\nTime: {$booking['time']} (Asia/Manila)\nGuests: {$booking['guests']}\n"
        . "Status: {$booking['status']}\n";
    $messages = [];
    if ($event === 'created') {
        $messages[] = [$config['owner'], 'Casa Juana: new booking request',
            "A new request needs your review.\n\n" . $summary
            . "Name: {$booking['name']}\nContact: {$booking['contact']}\nOccasion: {$booking['occasion']}\nNotes: {$booking['notes']}\n\n"
            . "Sign in to your cafe website's /admin dashboard to review it. This booking is not confirmed yet."];
    }
    if (filter_var($booking['contact'], FILTER_VALIDATE_EMAIL)) {
        $statusCopy = match ($booking['status']) {
            'confirmed' => 'The cafe has confirmed your booking. Contact the cafe if you need to change your plans.',
            'cancelled' => 'Your booking has been cancelled. Contact the cafe if you have questions.',
            default => 'Your request is pending. This is not a confirmed reservation; the cafe will review availability and pricing.'
        };
        $messages[] = [$booking['contact'], $event === 'created'
            ? 'Casa Juana: booking request received' : 'Casa Juana: booking status updated',
            "Hello {$booking['name']},\n\n" . $statusCopy . "\n\n" . $summary
            . "\nFor changes or questions, call +63 960 385 0662 or reply to this email."];
    }
    $statement = $db->prepare('INSERT INTO email_outbox
        (id, booking_id, recipient, sender, subject, body, mode, next_attempt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    foreach ($messages as [$recipient, $subject, $body]) {
        $statement->execute([bin2hex(random_bytes(16)), $booking['id'], $recipient,
            $config['from'], $subject, $body, $config['mode'], time(), time()]);
    }
    return count($messages);
}

function changeBookingStatus(PDO $db, string $id, string $status): array
{
    if (!in_array($status, ['pending', 'confirmed', 'cancelled'], true)) {
        throw new BookingError('Choose pending, confirmed or cancelled.');
    }
    $db->exec('BEGIN IMMEDIATE');
    try {
        $query = $db->prepare('SELECT * FROM bookings WHERE id = ?');
        $query->execute([$id]);
        $booking = $query->fetch();
        if (!$booking) throw new BookingError('Booking not found.', 404);
        $queued = 0;
        $changed = $booking['status'] !== $status;
        if ($changed) {
            $db->prepare('UPDATE bookings SET status = ? WHERE id = ?')->execute([$status, $id]);
            $booking['status'] = $status;
            $queued = queueBookingEmails($db, $booking, 'status');
        }
        $db->exec('COMMIT');
        return ['id' => $id, 'status' => $status, 'changed' => $changed, 'emails_queued' => $queued];
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
}

function sendBookingEmail(array $email): bool
{
    foreach ([$email['sender'], $email['recipient']] as $address) {
        if (!filter_var($address, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $address)) {
            throw new RuntimeException('Invalid email address.');
        }
    }
    $domain = substr(strrchr($email['sender'], '@'), 1);
    return mail($email['recipient'], $email['subject'], quoted_printable_encode($email['body']), [
        'From' => $email['sender'], 'Reply-To' => emailConfig()['owner'],
        'MIME-Version' => '1.0', 'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'quoted-printable',
        'Message-ID' => '<' . $email['id'] . '@' . $domain . '>'
    ]);
}

// CLI worker only. A test transport can be injected without sending real email.
function processEmailQueue(PDO $db, ?callable $transport = null, int $limit = 20): array
{
    $mode = emailConfig()['mode'];
    $totals = ['accepted' => 0, 'previewed' => 0, 'retrying' => 0, 'failed' => 0];
    if ($mode === 'off') return $totals;
    $transport ??= 'sendBookingEmail';
    for ($index = 0; $index < $limit; $index++) {
        $now = time();
        $claim = bin2hex(random_bytes(16));
        $db->exec('BEGIN IMMEDIATE');
        try {
            $db->prepare("UPDATE email_outbox SET state = 'failed', claim = NULL, locked_until = 0,
                last_error = 'Worker lease expired after the final attempt; acceptance is unknown.'
                WHERE state = 'processing' AND locked_until <= ? AND attempts >= 5 AND mode = ?")
                ->execute([$now, $mode]);
            // Messages remain bound to the mode in which they were created.
            $query = $db->prepare("SELECT * FROM email_outbox WHERE mode = ? AND attempts < 5
                AND ((state = 'pending' AND next_attempt <= ?) OR (state = 'processing' AND locked_until <= ?))
                AND NOT EXISTS (SELECT 1 FROM email_outbox earlier WHERE earlier.booking_id = email_outbox.booking_id
                    AND earlier.recipient = email_outbox.recipient AND earlier.mode = email_outbox.mode AND earlier.rowid < email_outbox.rowid
                    AND earlier.state IN ('pending', 'processing')) ORDER BY rowid LIMIT 1");
            $query->execute([$mode, $now, $now]);
            $email = $query->fetch();
            if (!$email) { $db->exec('COMMIT'); break; }
            $db->prepare("UPDATE email_outbox SET state = 'processing', claim = ?, locked_until = ?, attempts = attempts + 1 WHERE id = ?")
                ->execute([$claim, $now + 900, $email['id']]);
            $db->exec('COMMIT');
        } catch (Throwable $error) {
            $db->exec('ROLLBACK');
            throw $error;
        }
        $attempts = (int) $email['attempts'] + 1;
        $accepted = false;
        if ($mode === 'mail') {
            try { $accepted = (bool) $transport($email); } catch (Throwable) { $accepted = false; }
        }
        $state = $mode === 'preview' ? 'previewed' : ($accepted ? 'accepted' : ($attempts >= 5 ? 'failed' : 'pending'));
        $error = $state === 'pending' || $state === 'failed' ? 'Mail transport did not confirm acceptance.' : null;
        $db->prepare('UPDATE email_outbox SET state = ?, accepted_at = ?, last_error = ?, next_attempt = ?, locked_until = 0, claim = NULL WHERE id = ? AND claim = ?')
            ->execute([$state, $accepted ? time() : null, $error, time() + min(3600, 60 * (2 ** $attempts)), $email['id'], $claim]);
        $totals[$state === 'pending' ? 'retrying' : $state]++;
    }
    return $totals;
}
