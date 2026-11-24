<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/bookings.php';
require dirname(__DIR__) . '/src/admin.php';

try {
    $input = json_decode(stream_get_contents(STDIN, 4096), true, 8, JSON_THROW_ON_ERROR);
    $username = $input['username'] ?? null;
    $password = $input['password'] ?? null;
    if (!is_string($username) || !preg_match('/^[a-zA-Z0-9_.-]{3,50}$/D', $username)
        || !is_string($password) || strlen($password) < 12 || strlen($password) > 72) {
        throw new RuntimeException('Use a 3–50 character username (letters, numbers, _, ., -) and a password of 12–72 bytes.');
    }
    $db = adminDatabase();
    $statement = $db->prepare('INSERT INTO administrator (id, username, password_hash) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash');
    $statement->execute([$username, password_hash($password, PASSWORD_DEFAULT)]);
    fwrite(STDOUT, "Administrator saved. Previous dashboard sessions are invalidated. Open /admin to sign in.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Administrator setup failed. Check input (username: 3–50 allowed characters, password: 12–72 bytes), PHP SQLite support and database permissions.\n");
    exit(1);
}
