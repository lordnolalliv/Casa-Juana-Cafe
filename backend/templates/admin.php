<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= $account ? 'Booking dashboard' : 'Staff sign in' ?> | Casa Juana Cafe</title>
  <link rel="stylesheet" href="/admin.css">
</head>
<body>
<header><a class="brand" href="/admin"><img src="/casa-juana-logo.png" alt="">Casa Juana <span>Staff</span></a>
  <nav aria-label="Staff navigation"><a href="/">View website</a>
  <?php if ($account): ?><form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="<?= escapeAdmin($csrf) ?>"><button class="secondary">Sign out</button></form><?php endif; ?></nav>
</header>
<main>
<?php if ($error): ?><p class="message error" role="alert"><?= escapeAdmin($error) ?></p><?php endif; ?>
<?php if ($notice): ?><p class="message" role="status"><?= escapeAdmin($notice) ?></p><?php endif; ?>
<?php if (!$account): ?>
  <section class="login card"><p class="eyebrow">CASA JUANA CAFE</p><h1>A place for your plans.</h1><p class="muted">Sign in to review requests and manage bookings.</p>
  <form action="/admin/login" method="post">
    <input type="hidden" name="csrf" value="<?= escapeAdmin($csrf) ?>">
    <label for="username">Username</label><input id="username" name="username" autocomplete="username" maxlength="50" required>
    <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="72" required>
    <button class="full">Sign in</button>
  </form><p class="muted small">Need access or a password reset? Contact the site owner.</p></section>
<?php else: ?>
  <p class="eyebrow">BOOKING MANAGEMENT</p><h1>Welcome, <?= escapeAdmin($account['username']) ?>.</h1>
  <p class="muted">Review each request, check availability, and contact the customer before confirming.</p>
  <section class="stats" aria-label="Booking totals">
  <?php foreach ($counts as $status => $count): ?><a class="card" href="/admin?status=<?= $status ?>"><span><?= ucfirst($status) ?></span><strong><?= $count ?></strong></a><?php endforeach; ?>
  </section>
  <section aria-label="Booking requests">
  <form class="filters card" method="get" action="/admin">
    <div><label for="q">Search name, contact or reference</label><input id="q" name="q" maxlength="150" value="<?= escapeAdmin($search) ?>" placeholder="Find a booking"></div>
    <div><label for="status">Status</label><select id="status" name="status"><option value="">All statuses</option><?php foreach ($counts as $status => $_): ?><option value="<?= $status ?>" <?= $filter === $status ? 'selected' : '' ?>><?= ucfirst($status) ?></option><?php endforeach; ?></select></div>
    <button>Apply filters</button><a href="/admin">Clear</a>
  </form>
  <div class="results"><h2>Requests <span>(<?= $total ?>)</span></h2><span class="muted">Dates and times in the Philippines</span></div>
  <?php if (!$bookings): ?><div class="card empty"><h2>No requests found</h2><p class="muted">New bookings appear here after customers submit the website form. Try clearing your filters.</p></div><?php endif; ?>
  <?php foreach ($bookings as $booking): ?>
    <article class="card booking">
      <div class="booking-heading"><div><span class="badge <?= escapeAdmin($booking['status']) ?>"><?= ucfirst($booking['status']) ?></span><h2><?= escapeAdmin($booking['name']) ?></h2><p><?= escapeAdmin($booking['booking_type']) ?></p></div><div class="schedule"><strong><?= escapeAdmin($booking['date']) ?></strong><span><?= escapeAdmin($booking['time']) ?> · <?= escapeAdmin($booking['guests']) ?> guests</span></div></div>
      <dl><div><dt>Contact</dt><dd><?= escapeAdmin($booking['contact']) ?></dd></div><div><dt>Occasion</dt><dd><?= escapeAdmin($booking['occasion'] ?: 'Not specified') ?></dd></div><div><dt>Submitted</dt><dd><?= escapeAdmin((new DateTimeImmutable('@' . $booking['created_at']))->setTimezone(new DateTimeZone('Asia/Manila'))->format('M j, Y g:i A')) ?></dd></div></dl>
      <?php if ($booking['notes']): ?><div class="notes"><strong>Customer notes</strong><p><?= escapeAdmin($booking['notes']) ?></p></div><?php endif; ?>
      <details><summary>Request reference</summary><code><?= escapeAdmin($booking['id']) ?></code></details>
      <form class="status-form" method="post" action="/admin/status">
        <input type="hidden" name="csrf" value="<?= escapeAdmin($csrf) ?>"><input type="hidden" name="id" value="<?= escapeAdmin($booking['id']) ?>">
        <label for="status-<?= escapeAdmin($booking['id']) ?>">Update status</label><select id="status-<?= escapeAdmin($booking['id']) ?>" name="status"><?php foreach ($counts as $status => $_): ?><option value="<?= $status ?>" <?= $booking['status'] === $status ? 'selected' : '' ?>><?= ucfirst($status) ?></option><?php endforeach; ?></select><button>Save status</button>
      </form>
    </article>
  <?php endforeach; ?>
  <nav class="pagination" aria-label="Results pages">
    <?php if ($page > 1): ?><a href="/admin?<?= escapeAdmin(http_build_query(['q' => $search, 'status' => $filter, 'page' => $page - 1])) ?>">Previous</a><?php endif; ?>
    <span>Page <?= $page ?> of <?= max(1, (int) ceil($total / 20)) ?></span>
    <?php if ($page * 20 < $total): ?><a href="/admin?<?= escapeAdmin(http_build_query(['q' => $search, 'status' => $filter, 'page' => $page + 1])) ?>">Next</a><?php endif; ?>
  </nav></section>
  <p class="muted small">Status changes are saved here. Customer notifications must be sent separately.</p>
<?php endif; ?>
</main></body></html>
