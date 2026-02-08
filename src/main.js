const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusSub = document.getElementById("statusSub");
const retryBtn = document.getElementById("retryBtn");
const statusClose = document.getElementById("statusClose");

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

let invoke = null;
let listen = null;
let started = false;
let lastLoadPromise = null;
let loadingActive = false;
let progressLabel = "";
let serverName = "";
let serverDescription = "";
let serverHardware = null;
let activeLaunchCard = null;
const skipAutoInit = window.__TAURI_TEST_DISABLE_AUTO_INIT === true;

function resolveTauriApi() {
  const tauri = window.__TAURI__ || null;
  return {
    invoke: tauri?.core?.invoke || tauri?.tauri?.invoke || tauri?.invoke || null,
    listen: tauri?.event?.listen || null
  };
}

const fallbackDesktopCard = {
  productId: "desktop",
  title: "Рабочий стол",
  imageUrl: "",
  alt: "Доступ ко всему почти без ограничений.",
  requiredAccount: "",
  isFree: true,
  isDesktop: true
};

const loadingCard = {
  productId: "loading",
  title: "Загрузка",
  imageUrl: "",
  alt: "Загрузка",
  requiredAccount: "",
  isFree: false,
  isLoading: true,
  startLabel: "Загрузка"
};

retryBtn.addEventListener("click", () => {
  if (invoke) {
    loadCards();
  } else {
    window.location.reload();
  }
});

if (statusClose) {
  statusClose.addEventListener("click", () => clearStatus());
}

statusEl.addEventListener("click", (event) => {
  if (event.target === statusEl) {
    clearStatus();
  }
});

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatServerTitle(name) {
  const trimmed = String(name || "").trim();
  return `Добро пожаловать на сервер: ${trimmed || "…"}`;
}

function formatBytesToGb(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  const gb = bytes / (1024 ** 3);
  const rounded = Math.round(gb);
  return `${rounded}GB`;
}

function renderServerDescription() {
  const description = String(serverDescription || "").trim();
  if (!description) {
    return "<div class=\"server-details__empty\">Описание не указано.</div>";
  }
  return description;
}

function renderHardware(hardware) {
  if (!hardware) {
    return "<div class=\"server-details__empty\">Данных о железе нет.</div>";
  }
  const ramText = formatBytesToGb(hardware.ram_bytes) || "—";
  const cpuText = String(hardware?.processor?.version || "").trim() || "—";
  const gpu = Array.isArray(hardware.graphic) ? hardware.graphic[0] : null;
  const gpuName = String(gpu?.name || "").trim() || "—";
  const gpuRamText = formatBytesToGb(gpu?.ram_bytes);
  const gpuLine = `${gpuName}${gpuRamText ? ` / ${gpuRamText}` : ""}`;

  return `
    <div class="hardware-line">${escapeHtml(gpuLine)}</div>
    <div class="hardware-line">${escapeHtml(ramText)}</div>
    <div class="hardware-line">${escapeHtml(cpuText)}</div>
  `;
}

function renderServerDialogs() {
  return `
    <div class="page-actions">
      <button class="page-action" id="openDescription" type="button">Описание сервера и контакты</button>
      <button class="page-action" id="openHardware" type="button">Технические характеристики</button>
    </div>
    <div class="modal-overlay is-hidden" id="descriptionModal" data-modal>
      <div class="modal">
        <div class="modal__header">
          <div class="modal__title">Описание сервера и контакты</div>
          <button class="modal__close" type="button" data-close="descriptionModal">×</button>
        </div>
        <div class="modal__body" id="serverDescription">${renderServerDescription()}</div>
      </div>
    </div>
    <div class="modal-overlay is-hidden" id="hardwareModal" data-modal>
      <div class="modal">
        <div class="modal__header">
          <div class="modal__title">Технические характеристики</div>
          <button class="modal__close" type="button" data-close="hardwareModal">×</button>
        </div>
        <div class="modal__body" id="serverHardware">${renderHardware(serverHardware)}</div>
      </div>
    </div>
  `;
}

function setStationDetails(details = {}) {
  serverName = String(details.name || "").trim();
  serverDescription = String(details.description || "");
  serverHardware = details.hardware || null;
  const el = document.getElementById("serverTitleText");
  if (el) {
    el.textContent = formatServerTitle(serverName);
  }
  const descriptionEl = document.getElementById("serverDescription");
  if (descriptionEl) {
    descriptionEl.innerHTML = renderServerDescription();
  }
  const hardwareEl = document.getElementById("serverHardware");
  if (hardwareEl) {
    hardwareEl.innerHTML = renderHardware(serverHardware);
  }
}

function render(cards) {
  const header = `
    <div class="page-header">
      <h1 class="page__title"><span id="serverTitleText">${escapeHtml(formatServerTitle(serverName))}</span><span id="progressText">${escapeHtml(progressLabel)}</span></h1>
      ${renderServerDialogs()}
    </div>
    <div class="launch-overlay is-hidden" id="launchOverlay">
      <div class="launch-overlay__text">Нажмите в любом месте для возврата к списку игр</div>
    </div>
    <div class="row-break"></div>
  `;
  const items = cards.map(card => {
    const title = escapeHtml(card.title || "");
    const alt = escapeHtml(card.alt || "");
    const required = card.requiredAccount ? `<div class=\"gameList__item-badge-required-account\">${escapeHtml(card.requiredAccount)}</div>` : "";
    const free = card.isFree ? `<div class=\"gameList__item-badge-price\">Бесплатная</div>` : "";
    const isDesktop = card.isDesktop === true;
    const startLabel = escapeHtml(card.startLabel || "Играть");
    const startIcon = card.isLoading ? "" : "<i class=\\\"ivu-icon ivu-icon-md-log-in\\\"></i>";
    const startContent = startIcon ? `${startLabel}&nbsp;${startIcon}` : startLabel;
    const rawImageUrl = card.imageUrl || "";
    const safeImageUrl = rawImageUrl.replace(/'/g, "%27");
    const imageStyle = rawImageUrl ? ` style=\"background-image: url('${encodeURI(safeImageUrl)}')\"` : "";
    const placeholderClass = rawImageUrl ? "" : "card--placeholder";
    const loadingClass = card.isLoading ? "is-loading" : "";
    const loadingAttr = card.isLoading ? " data-loading=\"1\"" : "";

    return `
      <div class=\"gameList__item gameList__item-thumb ivu-card ivu-card-bordered ${placeholderClass} ${loadingClass}\" data-product-id=\"${escapeHtml(card.productId)}\" data-image-url=\"${escapeHtml(rawImageUrl)}\" data-is-desktop=\"${isDesktop ? "1" : "0"}\"${loadingAttr}>
        <div class=\"ivu-card-body\">
          <a href=\"#\" class=\"gameList__item-overlay\" title=\"${alt}\">${title}</a>
          <div class=\"gameList__item-image\"${imageStyle}></div>
          <div class=\"gameList__item-title\"><span>${title}</span></div>
          <div class=\"gameList__item-start gameList__item-start_active\">${startContent}</div>
          <div class=\"gameList__item-badges\">${required}${free}</div>
        </div>
      </div>
    `;
  }).join("");

  grid.innerHTML = header + items;

  const openDescription = document.getElementById("openDescription");
  if (openDescription) {
    openDescription.addEventListener("click", () => openModal("descriptionModal"));
  }
  const openHardware = document.getElementById("openHardware");
  if (openHardware) {
    openHardware.addEventListener("click", () => openModal("hardwareModal"));
  }

  const modals = grid.querySelectorAll("[data-modal]");
  modals.forEach(modal => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal(modal.id);
      }
    });
  });

  const closes = grid.querySelectorAll("[data-close]");
  closes.forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });

  const launchOverlay = document.getElementById("launchOverlay");
  if (launchOverlay) {
    launchOverlay.addEventListener("click", () => hideLaunchOverlay(false));
  }

  [...grid.querySelectorAll(".gameList__item")].forEach(cardEl => {
    const imageUrl = cardEl.dataset.imageUrl;
    if (imageUrl) {
      preloadImage(cardEl, imageUrl);
    }

    cardEl.addEventListener("click", async (event) => {
      event.preventDefault();
      const productId = cardEl.dataset.productId;
      const isDesktop = cardEl.dataset.isDesktop === "1";
      if (cardEl.dataset.loading === "1") return;
      if (!productId) return;
      if (cardEl.classList.contains("is-launching")) return;
      cardEl.classList.add("is-launching");
      activeLaunchCard = cardEl;
      if (!invoke) {
        setStatus("Запуск доступен только в приложении", "", false);
        setTimeout(() => cardEl.classList.remove("is-launching"), 800);
        return;
      }
      if (!isDesktop) {
        showLaunchOverlay(5000);
      }
      try {
        await withTimeout(invoke("launch_game", { productId }), 10_000, "Таймаут запуска");
        if (isDesktop) {
          activeLaunchCard = null;
        }
      } catch (error) {
        cardEl.classList.remove("is-launching");
        activeLaunchCard = null;
        setStatus("Ошибка запуска", String(error), false);
      }
    });
  });
}

function renderLoading(count = 6) {
  const cards = Array.from({ length: count }, (_, index) => ({
    ...loadingCard,
    productId: `loading-${index + 1}`
  }));
  render(cards);
}

function setProgressLabel(label) {
  progressLabel = label || "";
  const el = document.getElementById("progressText");
  if (el) {
    el.textContent = progressLabel;
  }
}

function showLaunchOverlay(minDurationMs = 5000) {
  const overlay = document.getElementById("launchOverlay");
  if (!overlay) return;
  overlay.dataset.canDismiss = "0";
  overlay.classList.remove("is-hidden");
  setTimeout(() => {
    overlay.dataset.canDismiss = "1";
  }, minDurationMs);
}

function hideLaunchOverlay(force = false) {
  const overlay = document.getElementById("launchOverlay");
  if (!overlay) return;
  if (!force && overlay.dataset.canDismiss !== "1") return;
  overlay.classList.add("is-hidden");
  if (activeLaunchCard) {
    activeLaunchCard.classList.remove("is-launching");
    activeLaunchCard = null;
  }
}

async function loadStationDetails() {
  if (!invoke) return;
  try {
    const details = await invoke("load_station_details");
    setStationDetails(details);
  } catch (error) {
    // Ignore station details errors to keep the launcher usable.
  }
}

function formatProgressLabel(payload) {
  const text = payload.text || "Загрузка…";
  if (typeof payload.current === "number" && typeof payload.total === "number" && payload.total > 0) {
    return ` — ${text} ${payload.current}/${payload.total}`;
  }
  return ` — ${text}`;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("is-hidden");
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }
  document.body.classList.add("is-modal-open");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("is-hidden");
  if (document.querySelectorAll(".modal-overlay:not(.is-hidden)").length === 0) {
    document.body.classList.remove("is-modal-open");
    document.body.style.paddingRight = "";
  }
}

function setStatus(text, sub = "", showRetry = false) {
  statusText.textContent = text || "";
  statusSub.textContent = sub || "";
  retryBtn.style.display = showRetry ? "inline-flex" : "none";
  openModal("status");
}

function clearStatus() {
  closeModal("status");
}

function handleStatusEvent(payload) {
  if (!payload) return;
  if (loadingActive) {
    setProgressLabel(formatProgressLabel(payload));
    return;
  }
  const { text, current, total } = payload;
  if (typeof current === "number" && typeof total === "number" && total > 0) {
    setStatus(text || "Загрузка…", `Получено ${current}/${total}`);
    return;
  }
  setStatus(text || "Загрузка…");
}

function loadCards() {
  lastLoadPromise = (async () => {
    loadStationDetails();
    loadingActive = true;
    clearStatus();
    setProgressLabel(" — Загрузка…");
    renderLoading();
    try {
      const cards = await invoke("load_cards");
      loadingActive = false;
      clearStatus();
      setProgressLabel("");
      render(cards || []);
    } catch (error) {
      loadingActive = false;
      setStatus("Ошибка загрузки данных", String(error), true);
      setProgressLabel("");
      render([fallbackDesktopCard]);
    }
  })();
  return lastLoadPromise;
}

function preloadImage(cardEl, imageUrl) {
  const img = new Image();
  img.onload = () => {
    cardEl.classList.remove("card--placeholder");
  };
  img.onerror = () => {
    const imageEl = cardEl.querySelector(".gameList__item-image");
    if (imageEl) imageEl.style.backgroundImage = "";
    cardEl.classList.add("card--placeholder");
  };
  img.src = imageUrl;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function initTauri(options = { load: true }) {
  if (started) return true;
  const api = resolveTauriApi();
  if (api.listen && !listen) {
    listen = api.listen;
    listen("status", (event) => handleStatusEvent(event.payload));
  }
  if (api.invoke && !invoke) {
    invoke = api.invoke;
  }
  if (invoke && !started) {
    started = true;
    if (options.load) {
      loadCards();
    }
    return true;
  }
  return false;
}

const params = new URLSearchParams(window.location.search);
const mockMode = params.get("mock") === "1";

if (!skipAutoInit) {
  if (!initTauri()) {
    if (mockMode) {
      setProgressLabel(" — Загрузка…");
      renderLoading();
      fetch("/mock-data.json")
        .then(res => res.json())
        .then(cards => {
          setProgressLabel("");
          render(cards);
        })
        .catch(() => {
          setProgressLabel("");
          setStatus("Не удалось загрузить mock-data.json", "", true);
        });
    } else {
      window.addEventListener("DOMContentLoaded", () => {
        if (!started) initTauri();
      });
      setTimeout(() => {
        if (!started) initTauri();
      }, 0);
    }
  }
} else if (mockMode) {
  setProgressLabel(" — Загрузка…");
  fetch("/mock-data.json")
    .then(res => res.json())
    .then(cards => {
      setProgressLabel("");
      render(cards);
    })
    .catch(() => {
      setProgressLabel("");
      setStatus("Не удалось загрузить mock-data.json", "", true);
    });
}

window.__setCards = render;
window.__setStatus = setStatus;
window.__clearStatus = clearStatus;
window.__resetLauncher = () => {
  invoke = null;
  listen = null;
  started = false;
  if (window.__TAURI_TEST_DISABLE_AUTO_INIT === true) {
    const api = resolveTauriApi();
    if (api.listen) {
      listen = api.listen;
      listen("status", (event) => handleStatusEvent(event.payload));
    }
    if (api.invoke) {
      invoke = api.invoke;
      started = true;
      return loadCards();
    }
    return Promise.resolve();
  }

  initTauri({ load: false });
  if (invoke) {
    return loadCards();
  }
  return Promise.resolve();
};
window.__lastLoadPromise = () => lastLoadPromise;
