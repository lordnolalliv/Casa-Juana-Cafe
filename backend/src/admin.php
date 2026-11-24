<?php
declare(strict_types=1);

function adminDatabase(): PDO
{
    $db = bookingDatabase();
    $db->exec('CREATE TABLE IF NOT EXISTS administrator (id INTEGER PRIMARY KEY CHECK(id = 1), username TEXT NOT NULL, password_hash TEXT NOT NULL)');
    $db->exec('CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started_at INTEGER NOT NULL)');
    return $db;
}

function startAdminSession(): void
{
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('casa_admin');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/admin',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || getenv('CASA_SECURE_COOKIES') === '1',
        'httponly' => true, 'samesite' => 'Strict'
    ]);
    if (!session_start()) {
        throw new RuntimeException('Cannot initialize session storage.');
    }
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}

function adminCsrf(): void
{
    $token = $_POST['csrf'] ?? null;
    if (!is_string($token) || !hash_equals($_SESSION['csrf'], $token)) {
        throw new BookingError('This form expired. Reload the page and try again.', 403);
    }
}

function currentAdmin(PDO $db): ?array
{
    $account = $db->query('SELECT username, password_hash FROM administrator WHERE id = 1')->fetch();
    if (!$account || !isset($_SESSION['identity'], $_SESSION['last_seen'], $_SESSION['signed_in'])
        || !hash_equals(hash('sha256', $account['password_hash']), $_SESSION['identity'])
        || time() - $_SESSION['last_seen'] > 1800 || time() - $_SESSION['signed_in'] > 28800) {
        unset($_SESSION['identity'], $_SESSION['last_seen'], $_SESSION['signed_in']);
        return null;
    }
    $_SESSION['last_seen'] = time();
    return $account;
}

function loginAdmin(PDO $db, mixed $username, mixed $password): void
{
    $account = $db->query('SELECT username, password_hash FROM administrator WHERE id = 1')->fetch();
    if (!$account) {
        throw new BookingError('An administrator account has not been configured. Ask the site owner to run the setup command.', 503);
    }
    $key = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $now = time();
    $db->exec('BEGIN IMMEDIATE');
    try {
        $db->prepare('DELETE FROM login_attempts WHERE started_at <= ?')->execute([$now - 900]);
        $query = $db->prepare('SELECT attempts FROM login_attempts WHERE ip_hash = ?');
        $query->execute([$key]);
        if ((int) $query->fetchColumn() >= 5) {
            throw new BookingError('Too many sign-in attempts. Try again in 15 minutes.', 429);
        }
        $db->prepare('INSERT INTO login_attempts (ip_hash, attempts, started_at) VALUES (?, 1, ?)
            ON CONFLICT(ip_hash) DO UPDATE SET attempts = attempts + 1')->execute([$key, $now]);
        $db->exec('COMMIT');
    } catch (Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
    $validPassword = is_string($password) && strlen($password) <= 72
        && password_verify($password, $account['password_hash']);
    if (!$validPassword || !is_string($username) || !hash_equals($account['username'], trim($username))) {
        throw new BookingError('Incorrect username or password.', 401);
    }
    $db->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$key]);
    session_regenerate_id(true);
    $_SESSION = ['identity' => hash('sha256', $account['password_hash']),
        'signed_in' => $now, 'last_seen' => $now, 'csrf' => bin2hex(random_bytes(32))];
}

function adminRedirect(): never
{
    header('Location: /admin', true, 303);
    exit;
}

function escapeAdmin(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function handleAdmin(string $path, string $method): never
{
    header('Cache-Control: no-store');
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    $error = '';
    $account = null;
    $bookings = [];
    $counts = ['pending' => 0, 'confirmed' => 0, 'cancelled' => 0];
    $total = 0;
    $page = 1;
    $filter = '';
    $search = '';
    $notice = '';
    try {
        startAdminSession();
        $db = adminDatabase();
        $account = currentAdmin($db);
        if ($method === 'POST') {
            adminCsrf();
            if ($path === '/admin/login') {
                loginAdmin($db, $_POST['username'] ?? null, $_POST['password'] ?? null);
                adminRedirect();
            }
            if ($path === '/admin/logout') {
                $_SESSION = [];
                session_destroy();
                setcookie(session_name(), '', ['expires' => time() - 3600] + adminCookieDeletionOptions());
                adminRedirect();
            }
            if ($path === '/admin/status') {
                if (!$account) {
                    throw new BookingError('Your session expired. Sign in again.', 401);
                }
                $id = $_POST['id'] ?? null;
                $status = $_POST['status'] ?? null;
                if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/D', $id)
                    || !in_array($status, ['pending', 'confirmed', 'cancelled'], true)) {
                    throw new BookingError('Invalid booking or status.');
                }
                $query = $db->prepare('UPDATE bookings SET status = ? WHERE id = ?');
                $query->execute([$status, $id]);
                if (!$query->rowCount()) {
                    throw new BookingError('Booking not found.', 404);
                }
                $_SESSION['notice'] = 'Booking status updated to ' . $status . '. Contact the customer to let them know.';
                adminRedirect();
            }
            throw new BookingError('Not found.', 404);
        }
        if ($method !== 'GET' || !in_array($path, ['/admin', '/admin/'], true)) {
            header('Allow: GET, POST');
            throw new BookingError('Page or method not available.', 405);
        }
        $notice = $_SESSION['notice'] ?? '';
        unset($_SESSION['notice']);
        if ($account) {
            $filter = is_string($_GET['status'] ?? null) ? $_GET['status'] : '';
            $search = is_string($_GET['q'] ?? null) ? trim($_GET['q']) : '';
            $page = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000000]]);
            if (!in_array($filter, ['', 'pending', 'confirmed', 'cancelled'], true) || strlen($search) > 150 || !$page) {
                $page = 1;
                $filter = $search = '';
                throw new BookingError('Invalid search or page.', 400);
            }
            foreach ($db->query('SELECT status, COUNT(*) AS total FROM bookings GROUP BY status') as $row) {
                $counts[$row['status']] = (int) $row['total'];
            }
            $where = "WHERE (? = '' OR status = ?) AND (? = '' OR instr(lower(name || ' ' || contact || ' ' || id), lower(?)) > 0)";
            $params = [$filter, $filter, $search, $search];
            $query = $db->prepare('SELECT COUNT(*) FROM bookings ' . $where);
            $query->execute($params);
            $total = (int) $query->fetchColumn();
            $query = $db->prepare('SELECT * FROM bookings ' . $where . ' ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ' . (($page - 1) * 20));
            $query->execute($params);
            $bookings = $query->fetchAll();
        }
    } catch (BookingError $failure) {
        http_response_code($failure->status);
        if ($failure->status === 429) header('Retry-After: 900');
        $error = $failure->getMessage();
    } catch (Throwable $failure) {
        http_response_code(503);
        error_log('Admin failure: ' . get_class($failure));
        $error = 'The dashboard is temporarily unavailable. Please try again later.';
    }
    $csrf = $_SESSION['csrf'] ?? '';
    require dirname(__DIR__) . '/templates/admin.php';
    exit;
}

function adminCookieDeletionOptions(): array
{
    $params = session_get_cookie_params();
    unset($params['lifetime']);
    return $params;
}
