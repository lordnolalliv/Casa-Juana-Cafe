<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bookings.php';

function respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}

function requireAdmin(): void
{
    $token = getenv('CASA_ADMIN_TOKEN') ?: '';
    if (strlen($token) < 32) {
        throw new BookingError('Booking management is not configured.', 503);
    }
    $authorization = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!hash_equals('Bearer ' . $token, $authorization)) {
        throw new BookingError('Authentication required.', 401);
    }
}

function readBody(): array
{
    $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if (!in_array($type, ['application/json', 'application/x-www-form-urlencoded'], true)) {
        throw new BookingError('Use JSON or URL-encoded form data.', 415);
    }
    $raw = file_get_contents('php://input', false, null, 0, 8193);
    if ($raw === false || strlen($raw) > 8192) {
        throw new BookingError('Request body exceeds 8 KB.', 413);
    }
    if ($type === 'application/json') {
        try {
            $body = json_decode($raw, false, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new BookingError('Invalid JSON.', 400);
        }
        if (!$body instanceof stdClass) {
            throw new BookingError('Expected a JSON object.', 400);
        }
        return (array) $body;
    }
    parse_str($raw, $body);
    return $body;
}

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
$root = dirname(__DIR__, 2);
// Only these public assets can be served. Source, secrets and the database stay private.
$assets = ['/script.js' => 'application/javascript', '/styles.css' => 'text/css',
    '/casa-juana-logo.png' => 'image/png'];
if ($path === '/' || $path === '/index.html' || isset($assets[$path])) {
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        header('Allow: GET, HEAD');
        respond(405, ['error' => 'Method not allowed.']);
    }
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: ' . ($assets[$path] ?? 'text/html') . (isset($assets[$path]) && $path === '/casa-juana-logo.png' ? '' : '; charset=utf-8'));
    if ($method === 'HEAD') {
        exit;
    }
    if (isset($assets[$path])) {
        readfile($root . $path);
    } else {
        echo str_replace('id="booking-form"', 'id="booking-form" data-booking-endpoint="/api/bookings"', file_get_contents($root . '/index.html'));
    }
    exit;
}

try {
    if ($path === '/api/bookings' && $method === 'POST') {
        $booking = validateBooking(readBody());
        $saved = saveBooking(bookingDatabase(), $booking, $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        respond($saved['duplicate'] ? 200 : 201, $saved + ['message' => 'Your request is recorded. Please keep your reference number. The cafe must confirm availability and pricing; this is not a confirmed booking.']);
    }
    if ($path === '/api/bookings' && $method === 'GET') {
        requireAdmin();
        $offset = filter_var($_GET['offset'] ?? '0', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($offset === false) {
            throw new BookingError('Invalid offset.', 400);
        }
        $query = bookingDatabase()->prepare('SELECT id, created_at, status, booking_type, date, time, guests, occasion, name, contact, notes FROM bookings ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ?');
        $query->bindValue(1, $offset, PDO::PARAM_INT);
        $query->execute();
        respond(200, ['bookings' => $query->fetchAll(), 'offset' => $offset, 'limit' => 50]);
    }
    if (preg_match('#^/api/bookings/([a-f0-9]{32})$#D', $path, $matches)) {
        if ($method !== 'PATCH') {
            header('Allow: PATCH');
            respond(405, ['error' => 'Method not allowed.']);
        }
        requireAdmin();
        $status = readBody()['status'] ?? null;
        if (!in_array($status, ['pending', 'confirmed', 'cancelled'], true)) {
            throw new BookingError('Choose pending, confirmed or cancelled.');
        }
        $query = bookingDatabase()->prepare('UPDATE bookings SET status = ? WHERE id = ?');
        $query->execute([$status, $matches[1]]);
        if ($query->rowCount() === 0) {
            throw new BookingError('Booking not found.', 404);
        }
        respond(200, ['id' => $matches[1], 'status' => $status]);
    }
    if ($path === '/api/bookings') {
        header('Allow: GET, POST');
        respond(405, ['error' => 'Method not allowed.']);
    }
    respond(404, ['error' => 'Not found.']);
} catch (BookingError $error) {
    if ($error->status === 429) {
        header('Retry-After: 600');
    }
    respond($error->status, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Booking API failure: ' . get_class($error));
    respond(503, ['error' => 'Booking service is temporarily unavailable. Please call the cafe or try again later.']);
}
