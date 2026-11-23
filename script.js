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
const localToday = new Date();
const dateOffset = localToday.getTimezoneOffset() * 60000;
bookingDate.min = new Date(localToday.getTime() - dateOffset).toISOString().slice(0, 10);

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

document.querySelector("#booking-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  updateBookingConstraints();
  validateContact();
  if (!form.reportValidity()) return;

  const booking = new FormData(form);
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
  document.querySelector("#form-message").textContent = "Your booking details are ready in WhatsApp. Send the message to request confirmation.";
});
