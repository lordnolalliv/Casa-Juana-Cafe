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

const carousel = document.querySelector(".hero-carousel");
const carouselSlides = Array.from(document.querySelectorAll(".hero-photo"));
const carouselDots = Array.from(document.querySelectorAll(".carousel-dot"));
const carouselToggle = document.querySelector("[data-carousel-toggle]");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

if (carousel && carouselSlides.length > 1 && carouselToggle) {
  let activeSlide = 0;
  let timer;
  let userPaused = reducedMotion.matches;
  let pointerInside = false;
  let focusInside = false;

  function updateCarousel() {
    carouselSlides.forEach((slide, index) => {
      const isActive = index === activeSlide;
      slide.classList.toggle("is-active", isActive);
      slide.setAttribute("aria-hidden", String(!isActive));
    });

    carouselDots.forEach((dot, index) => {
      const isActive = index === activeSlide;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-pressed", String(isActive));
    });
  }

  function showSlide(index) {
    activeSlide = (index + carouselSlides.length) % carouselSlides.length;
    updateCarousel();
  }

  function updateAutoplay() {
    window.clearInterval(timer);
    if (!userPaused && !pointerInside && !focusInside && !document.hidden) {
      timer = window.setInterval(() => showSlide(activeSlide + 1), 6000);
    }

    carouselToggle.textContent = userPaused ? "▶" : "Ⅱ";
    carouselToggle.setAttribute("aria-label", userPaused ? "Play slideshow" : "Pause slideshow");
    carouselToggle.setAttribute("aria-pressed", String(userPaused));
  }

  document.querySelector("[data-carousel-prev]").addEventListener("click", () => {
    showSlide(activeSlide - 1);
    updateAutoplay();
  });
  document.querySelector("[data-carousel-next]").addEventListener("click", () => {
    showSlide(activeSlide + 1);
    updateAutoplay();
  });
  carouselDots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      showSlide(index);
      updateAutoplay();
    });
  });
  carouselToggle.addEventListener("click", () => {
    userPaused = !userPaused;
    updateAutoplay();
  });
  carousel.addEventListener("pointerenter", () => {
    pointerInside = true;
    updateAutoplay();
  });
  carousel.addEventListener("pointerleave", () => {
    pointerInside = false;
    updateAutoplay();
  });
  carousel.addEventListener("focusin", () => {
    focusInside = true;
    updateAutoplay();
  });
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) {
      focusInside = false;
      updateAutoplay();
    }
  });
  document.addEventListener("visibilitychange", updateAutoplay);
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", (event) => {
      if (event.matches) {
        userPaused = true;
        updateAutoplay();
      }
    });
  }

  updateAutoplay();
}

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
const localToday = new Date();
const dateOffset = localToday.getTimezoneOffset() * 60000;
bookingDate.min = new Date(localToday.getTime() - dateOffset).toISOString().slice(0, 10);

if (BOOKING_ENDPOINT) {
  submitButton.firstChild.textContent = "Send booking request ";
  consentCopy.textContent = "I agree Casa Juana may store my details in its private booking sheet and contact me about this request. My request is not confirmed until the cafe replies.";
  bookingDisclaimer.textContent = "Your request is emailed to the cafe and stored in its private booking sheet. Rates vary by date, guest count, and package.";
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

bookingForm.addEventListener("submit", (event) => {
  updateBookingConstraints();
  validateContact();
  if (!bookingForm.reportValidity()) {
    event.preventDefault();
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
