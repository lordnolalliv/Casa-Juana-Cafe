<?php
declare(strict_types=1);

final class BookingError extends RuntimeException
{
    public function __construct(string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}

function validateBooking(array $input, ?DateTimeImmutable $now = null): array
{
    $limits = ['bookingType' => 80, 'date' => 10, 'time' => 5, 'guests' => 30,
        'occasion' => 80, 'name' => 100, 'contact' => 150, 'notes' => 1500,
        'website' => 200, 'consent' => 3];
    $booking = [];
    foreach ($limits as $key => $limit) {
        $value = $input[$key] ?? '';
        if (!is_string($value) || !preg_match('//u', $value) || strlen($value) > $limit
            || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $value)) {
            throw new BookingError("Invalid or too long field: $key.");
        }
        $booking[$key] = trim($value);
    }
    if ($booking['website'] !== '' || $booking['consent'] !== 'yes') {
        throw new BookingError('Please complete the form and agree to be contacted.');
    }
    if (!in_array($booking['bookingType'], ['Table reservation', 'Catering or packed meals',
        'Private event or venue', 'Pool day-use', 'Overnight stay'], true)
        || !in_array($booking['guests'], ['1–2', '3–5', '6–10', '11–20', '21–50', '51–100', 'More than 100'], true)) {
        throw new BookingError('Choose a valid booking type and guest count.');
    }
    $zone = new DateTimeZone('Asia/Manila');
    $now = ($now ?? new DateTimeImmutable('now', $zone))->setTimezone($zone);
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $booking['date'], $zone);
    if (!$date || $date->format('Y-m-d') !== $booking['date'] || $booking['date'] < $now->format('Y-m-d')) {
        throw new BookingError('Choose a valid date today or later (Philippine time).');
    }
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D', $booking['time'])) {
        throw new BookingError('Choose a valid time.');
    }
    if ($booking['bookingType'] === 'Table reservation'
        && ($date->format('w') === '0' || $booking['time'] < '08:00' || $booking['time'] > '17:00')) {
        throw new BookingError('Table reservations are available Monday–Saturday, 8:00 AM–5:00 PM.');
    }
    if ($booking['name'] === '' || preg_match('/[\r\n]/', $booking['name'])) {
        throw new BookingError('Enter your name on one line.');
    }
    $contact = $booking['contact'];
    $isEmail = filter_var($contact, FILTER_VALIDATE_EMAIL) !== false;
    $phone = preg_replace('/[\s().-]/', '', $contact);
    if (!$isEmail && !preg_match('/^\+?\d{7,15}$/D', $phone)) {
        throw new BookingError('Enter a valid email address or phone number.');
    }
    $booking['contactKey'] = strtolower($isEmail ? $contact : $phone);
    unset($booking['website'], $booking['consent']);
    return $booking;
}

function bookingDatabase(?string $path = null): PDO
{
    $path ??= getenv('CASA_DB_PATH') ?: dirname(__DIR__) . '/storage/bookings.sqlite';
    if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0700, true) && !is_dir(dirname($path))) {
        throw new RuntimeException('Cannot create storage directory.');
    }
    $db = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout = 5000');
    $db->exec("CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled')),
        booking_type TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
        guests TEXT NOT NULL, occasion TEXT NOT NULL, name TEXT NOT NULL,
        contact TEXT NOT NULL, notes TEXT NOT NULL, contact_key TEXT NOT NULL,
        request_hash TEXT NOT NULL, ip_hash TEXT NOT NULL)");
    $db->exec('CREATE INDEX IF NOT EXISTS bookings_contact_created ON bookings(contact_key, created_at)');
    $db->exec('CREATE INDEX IF NOT EXISTS bookings_ip_created ON bookings(ip_hash, created_at)');
    return $db;
}

function saveBooking(PDO $db, array $booking, string $ip, ?int $now = null): array
{
    $now ??= time();
    $hash = hash('sha256', json_encode($booking, JSON_THROW_ON_ERROR));
    $ipHash = hash('sha256', $ip);
    // Acquire the write lock before checking duplicates and rate limits.
    $db->exec('BEGIN IMMEDIATE');
    try {
        $query = $db->prepare('SELECT id, status FROM bookings WHERE contact_key = ? AND request_hash = ? AND created_at > ? LIMIT 1');
        $query->execute([$booking['contactKey'], $hash, $now - 600]);
        if ($existing = $query->fetch()) {
            $db->exec('COMMIT');
            return $existing + ['duplicate' => true];
        }
        $query = $db->prepare('SELECT COUNT(*) FROM bookings WHERE contact_key = ? AND created_at > ?');
        $query->execute([$booking['contactKey'], $now - 30]);
        if ((int) $query->fetchColumn() > 0) {
            throw new BookingError('Please wait 30 seconds before sending another request.', 429);
        }
        $query = $db->prepare('SELECT COUNT(*) FROM bookings WHERE ip_hash = ? AND created_at > ?');
        $query->execute([$ipHash, $now - 600]);
        if ((int) $query->fetchColumn() >= 10) {
            throw new BookingError('Too many requests. Please try again in 10 minutes.', 429);
        }
        $id = bin2hex(random_bytes(16));
        $query = $db->prepare('INSERT INTO bookings
            (id, created_at, booking_type, date, time, guests, occasion, name, contact, notes, contact_key, request_hash, ip_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $query->execute([$id, $now, $booking['bookingType'], $booking['date'], $booking['time'],
            $booking['guests'], $booking['occasion'], $booking['name'], $booking['contact'],
            $booking['notes'], $booking['contactKey'], $hash, $ipHash]);
        $db->exec('COMMIT');
        return ['id' => $id, 'status' => 'pending', 'duplicate' => false];
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
}
