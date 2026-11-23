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
const localToday = new Date();
const dateOffset = localToday.getTimezoneOffset() * 60000;
bookingDate.min = new Date(localToday.getTime() - dateOffset).toISOString().slice(0, 10);

document.querySelector("#booking-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const booking = new FormData(form);
  const message = [
    "Hello Casa Juana Cafe! I'd like to make a booking inquiry.",
    "",
    `Booking: ${booking.get("bookingType")}`,
    `Preferred date: ${booking.get("date")}`,
    `Guests: ${booking.get("guests")}`,
    `Name: ${booking.get("name")}`,
    `Contact: ${booking.get("contact")}`,
    booking.get("notes") ? `Details: ${booking.get("notes")}` : ""
  ].filter(Boolean).join("\n");

  const whatsappUrl = `https://wa.me/639603850662?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  document.querySelector("#form-message").textContent = "Your booking details are ready in WhatsApp. Send the message to request confirmation.";
});
