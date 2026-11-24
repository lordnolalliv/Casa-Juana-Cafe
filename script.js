const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
  mainNav.classList.toggle("is-open", !isOpen);
});

mainNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open navigation");
  });
});

const bookingDate = document.querySelector("#booking-date");
const bookingTime = document.querySelector("#booking-time");
const bookingType = document.querySelector("#booking-type");
const customerContact = document.querySelector("#customer-contact");
const bookingForm = document.querySelector("#booking-form");
const bookingMessage = document.querySelector("#form-message");
const submitButton = bookingForm.querySelector('button[type="submit"]');
const bookingDisclaimer = document.querySelector("#booking-disclaimer");
const consentCopy = bookingForm.querySelector(".consent-row span");
const BOOKING_ENDPOINT = "";
const PHP_BOOKING_ENDPOINT = bookingForm.dataset.bookingEndpoint || "";
const localToday = new Date();
const dateOffset = localToday.getTimezoneOffset() * 60000;
bookingDate.min = new Date(localToday.getTime() - dateOffset).toISOString().slice(0, 10);

if (BOOKING_ENDPOINT) {
  submitButton.firstChild.textContent = "Send booking request ";
  consentCopy.textContent = "I agree Casa Juana may store my details in its private booking sheet and contact me about this request. My request is not confirmed until the cafe replies.";
  bookingDisclaimer.textContent = "Your request is emailed to the cafe and stored in its private booking sheet. Rates vary by date, guest count, and package.";
}

if (PHP_BOOKING_ENDPOINT) {
  submitButton.firstChild.textContent = "Send booking request ";
  consentCopy.textContent = "I agree Casa Juana may store my details and contact me about this request. My request is not confirmed until the cafe replies.";
  bookingDisclaimer.textContent = "Your request is saved for the cafe to review. Rates vary by date, guest count, and package.";
  const manilaParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type) => manilaParts.find((item) => item.type === type).value;
  bookingDate.min = `${part("year")}-${part("month")}-${part("day")}`;
}

function updateBookingConstraints() {
  const isCafeTable = bookingType.value === "Table reservation";
  bookingTime.min = isCafeTable ? "08:00" : "";
  bookingTime.max = isCafeTable ? "17:00" : "";

  const selectedDate = bookingDate.value
    ? new Date(`${bookingDate.value}T12:00:00`)
    : null;
  bookingDate.setCustomValidity(
    isCafeTable && selectedDate && selectedDate.getDay() === 0
      ? "Cafe table reservations are available Monday through Saturday. For Sunday events, choose another booking type."
      : ""
  );

  const timeIsOutsideCafeHours = isCafeTable && bookingTime.value &&
    (bookingTime.value < "08:00" || bookingTime.value > "17:00");
  bookingTime.setCustomValidity(
    timeIsOutsideCafeHours ? "Cafe table reservations are available from 8:00 AM to 5:00 PM." : ""
  );
}

bookingType.addEventListener("change", updateBookingConstraints);
bookingDate.addEventListener("input", updateBookingConstraints);
bookingTime.addEventListener("input", updateBookingConstraints);

function validateContact() {
  const value = customerContact.value.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const phone = value.replace(/[^\d+]/g, "");
  const isPhone = /^\+?\d{7,15}$/.test(phone);
  customerContact.setCustomValidity(
    isEmail || isPhone ? "" : "Enter a valid email address or phone number."
  );
}

customerContact.addEventListener("input", validateContact);

bookingForm.addEventListener("submit", async (event) => {
  updateBookingConstraints();
  validateContact();
  if (!bookingForm.reportValidity()) {
    event.preventDefault();
    return;
  }

  if (PHP_BOOKING_ENDPOINT) {
    event.preventDefault();
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    bookingForm.setAttribute("aria-busy", "true");
    bookingMessage.textContent = "Sending your booking request...";
    try {
      const response = await fetch(PHP_BOOKING_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams(new FormData(bookingForm)),
        signal: AbortSignal.timeout(20000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save your request.");
      bookingMessage.textContent = `${result.message} Reference: ${result.id}`;
    } catch (error) {
      bookingMessage.textContent = error.name === "TimeoutError" || error instanceof TypeError || error instanceof SyntaxError
        ? "We couldn't verify whether your request was saved. Retry with the same details, or call +63 960 385 0662."
        : error.message;
    } finally {
      submitButton.disabled = false;
      bookingForm.removeAttribute("aria-busy");
    }
    return;
  }

  if (BOOKING_ENDPOINT) {
    event.preventDefault();
    bookingForm.action = BOOKING_ENDPOINT;
    bookingForm.method = "post";
    bookingForm.target = "_blank";
    bookingMessage.textContent = "Sending your request securely. A receipt will open in a new tab.";
    bookingForm.submit();
    return;
  }

  event.preventDefault();

  const booking = new FormData(bookingForm);
  const date = new Date(`${booking.get("date")}T12:00:00`);
  const formattedDate = new Intl.DateTimeFormat("en-PH", { dateStyle: "full" }).format(date);
  const message = [
    "Hello Casa Juana Cafe! I'd like to make a booking inquiry.",
    "",
    `Booking: ${booking.get("bookingType")}`,
    `Preferred date: ${formattedDate}`,
    `Preferred time: ${booking.get("time")}`,
    `Guests: ${booking.get("guests")}`,
    booking.get("occasion") ? `Occasion: ${booking.get("occasion")}` : "",
    `Name: ${booking.get("name")}`,
    `Contact: ${booking.get("contact")}`,
    booking.get("notes") ? `Details: ${booking.get("notes")}` : ""
  ].filter(Boolean).join("\n");

  const whatsappUrl = `https://wa.me/639603850662?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  bookingMessage.textContent = "Your booking details are ready in WhatsApp. Send the message to request confirmation.";
});
