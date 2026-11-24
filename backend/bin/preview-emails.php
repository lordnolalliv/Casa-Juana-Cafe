<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/bookings.php';
try {
    $query = bookingDatabase()->query("SELECT recipient, subject, body, state FROM email_outbox WHERE mode = 'preview' ORDER BY rowid DESC LIMIT 20");
    foreach ($query as $email) {
        echo json_encode($email, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . PHP_EOL;
    }
} catch (Throwable $error) {
    fwrite(STDERR, "Could not read email previews. Check database access.\n");
    exit(1);
}
