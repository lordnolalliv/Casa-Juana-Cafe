<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/bookings.php';
try {
    echo json_encode(processEmailQueue(bookingDatabase()), JSON_THROW_ON_ERROR) . PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, "Email worker failed. Check database access and CASA_MAIL_MODE, CASA_MAIL_FROM and CASA_OWNER_EMAIL.\n");
    exit(1);
}
