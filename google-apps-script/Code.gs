var BUSINESS_EMAIL = "lordvillalon@gmail.com";
var BUSINESS_NAME = "Casa Juana Cafe";
var SHEET_PROPERTY = "CASA_JUANA_BOOKINGS_SHEET_ID";
var BOOKING_TYPES = [
  "Table reservation",
  "Catering or packed meals",
  "Private event or venue",
  "Pool day-use",
  "Overnight stay"
];
var GUEST_COUNTS = ["1–2", "3–5", "6–10", "11–20", "21–50", "51–100", "More than 100"];
var HEADERS = [
  "Submitted at",
  "Request ID",
  "Status",
  "Booking type",
  "Preferred date",
  "Preferred time",
  "Guests",
  "Occasion",
  "Name",
  "Contact",
  "Notes"
];

function doPost(event) {
  try {
    var booking = validateBooking_(event && event.parameter ? event.parameter : {});
    var saved = saveBooking_(booking);
    var ownerEmailSent = sendOwnerNotification_(booking, saved);
    var customerEmailSent = booking.email ? sendCustomerAcknowledgement_(booking, saved) : false;

    if (!ownerEmailSent) {
      return resultPage_(
        "Request recorded",
        "Your request was saved, but the cafe notification email could not be sent. Please call or message the cafe to make sure they see it.",
        true
      );
    }

    var followUp = booking.email
      ? customerEmailSent
        ? "A receipt has been sent to your email. The cafe will confirm availability and pricing with you."
        : "The cafe received your request. We couldn't send an email receipt, so please keep this page as confirmation of submission."
      : "The cafe received your request and will follow up using the contact details you provided.";

    return resultPage_("Request received", followUp + " Your booking is not confirmed until the cafe replies.", false);
  } catch (error) {
    console.error("Booking submission failed: " + error.message);
    return resultPage_(
      "We couldn't submit your request",
      "Please try again, or contact the cafe by phone or Facebook Messenger.",
      true
    );
  }
}

function validateBooking_(parameters) {
  if (String(parameters.website || "").trim()) {
    throw new Error("Spam check failed.");
  }
  if (parameters.consent !== "yes") {
    throw new Error("Consent is required.");
  }

  var booking = {
    type: field_(parameters.bookingType, 80),
    date: field_(parameters.date, 10),
    time: field_(parameters.time, 5),
    guests: field_(parameters.guests, 30),
    occasion: field_(parameters.occasion, 80),
    name: field_(parameters.name, 100).replace(/[\r\n]/g, " "),
    contact: field_(parameters.contact, 150),
    notes: field_(parameters.notes, 1500)
  };

  if (BOOKING_TYPES.indexOf(booking.type) === -1) {
    throw new Error("Invalid booking type.");
  }
  if (GUEST_COUNTS.indexOf(booking.guests) === -1) {
    throw new Error("Invalid guest count.");
  }
  if (!booking.name || !booking.contact || !validDate_(booking.date) || !/^\d{2}:\d{2}$/.test(booking.time)) {
    throw new Error("Required booking details are missing or invalid.");
  }

  var isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.contact);
  var phone = booking.contact.replace(/[^\d+]/g, "");
  var isPhone = /^\+?\d{7,15}$/.test(phone);
  if (!isEmail && !isPhone) {
    throw new Error("A valid email address or phone number is required.");
  }
  booking.email = isEmail ? booking.contact : "";

  if (booking.type === "Table reservation") {
    var dateParts = booking.date.split("-");
    var weekday = new Date(Date.UTC(+dateParts[0], +dateParts[1] - 1, +dateParts[2])).getUTCDay();
    if (weekday === 0 || booking.time < "08:00" || booking.time > "17:00") {
      throw new Error("Cafe table reservations are available Monday to Saturday, 8:00 AM to 5:00 PM.");
    }
  }

  return booking;
}

function validDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  var parts = value.split("-");
  var date = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  var validCalendarDate = date.toISOString().slice(0, 10) === value;
  var todayInBohol = Utilities.formatDate(new Date(), "Asia/Manila", "yyyy-MM-dd");
  return validCalendarDate && value >= todayInBohol;
}

function field_(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function saveBooking_(booking) {
  var cache = CacheService.getScriptCache();
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    booking.contact.toLowerCase(),
    Utilities.Charset.UTF_8
  );
  var cacheKey = "booking-" + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
  if (cache.get(cacheKey)) {
    throw new Error("A recent request already used this contact.");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var spreadsheet = getOrCreateSpreadsheet_();
    var sheet = spreadsheet.getSheetByName("Booking requests");
    var requestId = Utilities.getUuid().slice(0, 8).toUpperCase();
    sheet.appendRow([
      new Date(),
      requestId,
      "Pending",
      sheetValue_(booking.type),
      sheetValue_(booking.date),
      sheetValue_(booking.time),
      sheetValue_(booking.guests),
      sheetValue_(booking.occasion),
      sheetValue_(booking.name),
      sheetValue_(booking.contact),
      sheetValue_(booking.notes)
    ]);
    cache.put(cacheKey, "1", 30);
    return { id: requestId, url: spreadsheet.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSpreadsheet_() {
  var properties = PropertiesService.getScriptProperties();
  var sheetId = properties.getProperty(SHEET_PROPERTY);
  if (sheetId) {
    return SpreadsheetApp.openById(sheetId);
  }

  var spreadsheet = SpreadsheetApp.create(BUSINESS_NAME + " Booking Requests");
  var sheet = spreadsheet.getSheets()[0];
  sheet.setName("Booking requests");
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  properties.setProperty(SHEET_PROPERTY, spreadsheet.getId());
  return spreadsheet;
}

function sheetValue_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function sendOwnerNotification_(booking, saved) {
  var subject = "New " + booking.type + " inquiry from " + booking.name;
  var body = [
    "A new booking request was recorded for " + BUSINESS_NAME + ".",
    "",
    "Request ID: " + saved.id,
    "Status: Pending — not confirmed",
    "Booking: " + booking.type,
    "Date: " + booking.date,
    "Time: " + booking.time,
    "Guests: " + booking.guests,
    "Occasion: " + (booking.occasion || "Not specified"),
    "Name: " + booking.name,
    "Contact: " + booking.contact,
    "Notes: " + (booking.notes || "None"),
    "",
    "Open the private booking sheet: " + saved.url
  ].join("\n");
  var options = {};
  if (booking.email) {
    options.replyTo = booking.email;
  }

  try {
    MailApp.sendEmail(BUSINESS_EMAIL, subject, body, options);
    return true;
  } catch (error) {
    console.error("Booking was saved, but the cafe notification could not be sent: " + error.message);
    return false;
  }
}

function sendCustomerAcknowledgement_(booking, saved) {
  var body = [
    "Hello " + booking.name + ",",
    "",
    BUSINESS_NAME + " received your booking request. This is not a confirmation; the cafe will check availability and follow up with you.",
    "",
    "Request ID: " + saved.id,
    "Booking: " + booking.type,
    "Preferred date and time: " + booking.date + " at " + booking.time,
    "Guests: " + booking.guests,
    "",
    "If you need to update the request, call +63 960 385 0662 or message Casa Juana Cafe on Facebook."
  ].join("\n");

  try {
    MailApp.sendEmail(booking.email, "Casa Juana Cafe received your request", body);
    return true;
  } catch (error) {
    console.error("Booking was saved, but the customer email acknowledgement could not be sent: " + error.message);
    return false;
  }
}

function resultPage_(title, message, isError) {
  var color = isError ? "#9b452d" : "#304c3e";
  var html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + "<title>" + title + " | Casa Juana Cafe</title>"
    + '<style>body{margin:0;padding:48px 20px;background:#f7f4ec;color:#263a31;font:16px Arial,sans-serif}'
    + '.card{max-width:560px;margin:8vh auto;padding:36px;background:#fffdf8;border-top:5px solid ' + color + ';box-shadow:0 12px 38px #263a3118}'
    + 'h1{font:500 32px Georgia,serif}p{line-height:1.7;color:#5f6b62}.links{display:flex;gap:18px;flex-wrap:wrap;margin-top:24px}'
    + 'a{color:#304c3e;font-weight:bold}</style><main class="card"><h1>' + title + "</h1><p>" + message + "</p>"
    + '<div class="links"><a href="tel:+639603850662">Call +63 960 385 0662</a>'
    + '<a href="https://www.facebook.com/casajuanacafe">Message on Facebook</a></div></main></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title + " | Casa Juana Cafe");
}
