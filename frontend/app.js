const fallbackProducts = [
  {
    id: "dreamy-lavender",
    name: "Dreamy Lavender",
    lead: "Soft lavender petals layered with bergamot and a whisper of clean musk.",
    detail:
      "An elegant composition that feels like fresh linen in a quiet suite—calming, airy, and endlessly refined.",
    notes: "Top: Bergamot, Neroli · Heart: Lavender, Iris · Base: Clean Musk, Cashmere Woods",
    image: "../figure/vmate_1.png",
    mood: "Serene Calm",
  },
  {
    id: "white-tea-muse",
    name: "White Tea Muse",
    lead: "Airy white tea, pear blossom, and sheer woods for a fresh, luminous aura.",
    detail:
      "A contemporary, luminous scent that brightens the cabin with clarity—crisp, polished, and quietly confident.",
    notes: "Top: White Tea, Pear · Heart: Lily, Magnolia · Base: Blonde Woods, Soft Amber",
    image: "../figure/vmate_2.png",
    mood: "Bright Clarity",
  },
  {
    id: "osmanthus-moon",
    name: "Osmanthus Moon",
    lead: "Golden osmanthus, honeyed apricot, and warm amber for a moonlit calm.",
    detail:
      "A velvety warmth with golden depth—designed for evening drives and a lingering sense of comfort.",
    notes: "Top: Osmanthus, Apricot · Heart: Amber, Honey · Base: Sandalwood, Soft Resin",
    image: "../figure/vmate_3.png",
    mood: "Golden Warmth",
  },
];

const productGrid = document.querySelector("[data-products]");

function renderProducts(products) {
  if (!productGrid) return;
  productGrid.innerHTML = products
    .map(
      (product) => `
        <article class="product-card">
          <img src="${product.image}" alt="${product.name}" loading="lazy" />
          <span>${product.mood}</span>
          <h3>${product.name}</h3>
          <p class="product-lead">${product.lead}</p>
          <p class="product-detail">${product.detail}</p>
          <div class="product-notes">
            <span>Notes</span>
            <p>${product.notes}</p>
          </div>
          <a class="product-action" href="#contact">Discover the scent</a>
        </article>
      `
    )
    .join("");
}

async function loadProducts() {
  try {
    const response = await fetch("/api/products");
    if (!response.ok) throw new Error("Failed to fetch products");
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid product payload");
    renderProducts(data);
  } catch (error) {
    renderProducts(fallbackProducts);
  }
}

function syncHeaderHeight() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const height = header.offsetHeight;
  document.documentElement.style.setProperty("--header-height", `${height}px`);
}

function initCarousel(carousel) {
  if (!carousel) return;

  const track = carousel.querySelector("[data-carousel-track]");
  const slides = Array.from(track.children);
  const prevButton = carousel.querySelector("[data-carousel-prev]");
  const nextButton = carousel.querySelector("[data-carousel-next]");
  const indicators = carousel.querySelector("[data-carousel-indicators]");

  let currentIndex = 0;
  let autoPlayId;
  const slideCount = slides.length;

  const indicatorButtons = slides.map((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Go to slide ${index + 1}`);
    button.addEventListener("click", () => goToSlide(index));
    indicators.appendChild(button);
    return button;
  });

  function updateIndicators() {
    indicatorButtons.forEach((button, index) => {
      button.classList.toggle("active", index === currentIndex);
    });
  }

  function goToSlide(index) {
    currentIndex = (index + slideCount) % slideCount;
    track.style.transform = `translateX(-${currentIndex * 100}%)`;
    updateIndicators();
  }

  function nextSlide() {
    goToSlide(currentIndex + 1);
  }

  function prevSlide() {
    goToSlide(currentIndex - 1);
  }

  function startAutoPlay() {
    stopAutoPlay();
    autoPlayId = window.setInterval(nextSlide, 4500);
  }

  function stopAutoPlay() {
    if (autoPlayId) {
      window.clearInterval(autoPlayId);
      autoPlayId = null;
    }
  }

  prevButton?.addEventListener("click", () => {
    prevSlide();
    startAutoPlay();
  });

  nextButton?.addEventListener("click", () => {
    nextSlide();
    startAutoPlay();
  });

  carousel.addEventListener("mouseenter", stopAutoPlay);
  carousel.addEventListener("mouseleave", startAutoPlay);
  carousel.addEventListener("focusin", stopAutoPlay);
  carousel.addEventListener("focusout", startAutoPlay);

  carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      prevSlide();
      startAutoPlay();
    } else if (event.key === "ArrowRight") {
      nextSlide();
      startAutoPlay();
    }
  });

  goToSlide(0);
  startAutoPlay();
}

loadProducts();
syncHeaderHeight();
window.addEventListener("resize", () => {
  window.clearTimeout(window.__headerResizeTimer);
  window.__headerResizeTimer = window.setTimeout(syncHeaderHeight, 120);
});
document.querySelectorAll("[data-carousel]").forEach((carousel) => {
  initCarousel(carousel);
});
