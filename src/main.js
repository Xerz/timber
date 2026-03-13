import {
  applyCardFilters,
  buildCardFilterOptions,
  LICENSE_FILTERS
} from "./model.js";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const statusSub = document.getElementById("statusSub");
const retryBtn = document.getElementById("retryBtn");
const statusClose = document.getElementById("statusClose");

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;

  const externalUrl = getExternalHttpUrl(link);
  if (!externalUrl) return;

  event.preventDefault();
  event.stopPropagation();
  openExternalUrl(externalUrl).catch((error) => {
    setStatus("Не удалось открыть ссылку", String(error), false);
  });
}, true);

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
let allCards = [];
let activeFilterDropdown = null;
let gameFilterQuery = "";
let filters = createInitialFilters();
const skipAutoInit = window.__TAURI_TEST_DISABLE_AUTO_INIT === true;

const licenseFilterItems = Object.freeze([
  { value: LICENSE_FILTERS.FREE, label: "Бесплатная лицензия" },
  { value: LICENSE_FILTERS.PAID, label: "Платная" }
]);

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

function createInitialFilters() {
  return {
    games: [],
    license: LICENSE_FILTERS.ANY,
    account: LICENSE_FILTERS.ANY
  };
}

function resetFilters() {
  filters = createInitialFilters();
  activeFilterDropdown = null;
  gameFilterQuery = "";
}

function setCards(cards = [], options = {}) {
  allCards = Array.isArray(cards) ? cards : [];
  if (options.resetFilters !== false) {
    resetFilters();
  }
  render(allCards);
}

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

document.addEventListener("click", (event) => {
  if (!activeFilterDropdown) return;
  if (event.target.closest("#filtersBar")) return;
  if (event.target.closest(".gameList__item")) return;
  if (event.target.closest(".page-action")) return;
  activeFilterDropdown = null;
  gameFilterQuery = "";
  render(allCards);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !activeFilterDropdown) return;
  activeFilterDropdown = null;
  gameFilterQuery = "";
  render(allCards);
});

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getExternalHttpUrl(link) {
  const rawHref = String(link?.getAttribute("href") || "").trim();
  if (!rawHref || !/^https?:\/\//i.test(rawHref)) return "";

  try {
    const url = new URL(rawHref, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch (error) {
    return "";
  }

  return "";
}

async function openExternalUrl(url) {
  if (invoke) {
    return invoke("open_external_url", { url });
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return null;
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

function renderCard(card) {
  const title = escapeHtml(card.title || "");
  const alt = escapeHtml(card.alt || "");
  const required = card.requiredAccount ? `<div class=\"gameList__item-badge-required-account\">${escapeHtml(card.requiredAccount)}</div>` : "";
  const free = card.isFree ? "<div class=\"gameList__item-badge-price\">Бесплатная</div>" : "";
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
}

function shouldShowFilters(cards = []) {
  return cards.some(card => card && card.isLoading !== true);
}

function getVisibleGameFilterOptions(options = []) {
  const query = String(gameFilterQuery || "").trim().toLocaleLowerCase("ru");
  if (!query) return options;
  return options.filter(option => option.toLocaleLowerCase("ru").includes(query));
}

function renderSelectedGameTags() {
  return filters.games.map(game => `
    <span class="filter-tag">
      <span class="filter-tag__label">${escapeHtml(game)}</span>
      <button class="filter-tag__remove" type="button" data-filter-remove-game="${escapeHtml(game)}" aria-label="Убрать ${escapeHtml(game)}">×</button>
    </span>
  `).join("");
}

function renderGameFilter(options = []) {
  const isOpen = activeFilterDropdown === "game";
  const visibleOptions = getVisibleGameFilterOptions(options);
  const items = visibleOptions.map(option => {
    const selected = filters.games.includes(option);
    return `<li class="ivu-select-item${selected ? " ivu-select-item-selected" : ""}" data-filter-option="game" data-value="${escapeHtml(option)}">${escapeHtml(option)}</li>`;
  }).join("");
  const placeholder = filters.games.length > 0 ? "" : "Игра";

  return `
    <div class="filter filter_game ivu-col ivu-col-span-12">
      <div class="ivu-select ivu-select-multiple ivu-select-default filter-select${isOpen ? " ivu-select-visible" : ""}" data-filter-root="game">
        <div tabindex="0" class="ivu-select-selection filter-select__selection" data-filter-toggle="game">
          <input type="hidden">
          <div class="filter-select__multiple-content">
            ${renderSelectedGameTags()}
            <input
              type="text"
              class="ivu-select-input filter-select__input"
              data-filter-search="game"
              placeholder="${escapeHtml(placeholder)}"
              autocomplete="off"
              spellcheck="false"
              value="${escapeHtml(gameFilterQuery)}"
            >
            <i class="ivu-icon ivu-icon-ios-arrow-down ivu-select-arrow"></i>
          </div>
        </div>
        <div class="ivu-select-dropdown filter-select__dropdown${isOpen ? "" : " is-hidden"}">
          <ul class="ivu-select-not-found"${visibleOptions.length > 0 ? " style=\"display: none;\"" : ""}>
            <li>Игра</li>
          </ul>
          <ul class="ivu-select-dropdown-list"${visibleOptions.length === 0 ? " style=\"display: none;\"" : ""}>
            ${items}
          </ul>
        </div>
      </div>
    </div>
  `;
}

function renderSingleFilter({ key, placeholder, selectedValue, allLabel, options = [] }) {
  const isOpen = activeFilterDropdown === key;
  const items = [
    { value: LICENSE_FILTERS.ANY, label: allLabel },
    ...options
  ].map(option => {
    const selected = option.value === selectedValue;
    return `<li class="ivu-select-item${selected ? " ivu-select-item-selected" : ""}" data-filter-option="${escapeHtml(key)}" data-value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</li>`;
  }).join("");
  const selectedLabel = options
    .concat({ value: LICENSE_FILTERS.ANY, label: allLabel })
    .find(option => option.value === selectedValue)?.label;
  const showPlaceholder = !selectedLabel || selectedValue === LICENSE_FILTERS.ANY;

  return `
    <div class="filter filter_${escapeHtml(key)} ivu-col ivu-col-span-6">
      <div class="ivu-select ivu-select-single ivu-select-default filter-select${isOpen ? " ivu-select-visible" : ""}" data-filter-root="${escapeHtml(key)}">
        <div tabindex="0" class="ivu-select-selection filter-select__selection" data-filter-toggle="${escapeHtml(key)}">
          <input type="hidden">
          <div class="filter-select__single-content">
            ${showPlaceholder
              ? `<span class="ivu-select-placeholder">${escapeHtml(placeholder)}</span>`
              : `<span class="ivu-select-selected-value">${escapeHtml(selectedLabel)}</span>`}
            <i class="ivu-icon ivu-icon-ios-arrow-down ivu-select-arrow"></i>
          </div>
        </div>
        <div class="ivu-select-dropdown filter-select__dropdown${isOpen ? "" : " is-hidden"}">
          <ul class="ivu-select-dropdown-list">
            ${items}
          </ul>
        </div>
      </div>
    </div>
  `;
}

function renderFilters(cards = []) {
  if (!shouldShowFilters(cards)) {
    return "";
  }

  const options = buildCardFilterOptions(cards);
  const accountOptions = options.accounts.map(account => ({ value: account, label: account }));

  return `
    <div class="stations__filter ivu-row ivu-row-flex filters-bar" id="filtersBar">
      ${renderGameFilter(options.games)}
      ${renderSingleFilter({
        key: "license",
        placeholder: "Лицензия",
        selectedValue: filters.license,
        allLabel: "Любая лицензия",
        options: licenseFilterItems
      })}
      ${renderSingleFilter({
        key: "account",
        placeholder: "Учетная запись",
        selectedValue: filters.account,
        allLabel: "Любой игровой аккаунт",
        options: accountOptions
      })}
    </div>
  `;
}

function renderEmptyState() {
  return `
    <div class="filters-empty">
      <div class="filters-empty__title">Игры не найдены</div>
      <div class="filters-empty__text">Измените фильтры и попробуйте снова.</div>
    </div>
  `;
}

function render(cards) {
  const displayCards = applyCardFilters(cards, filters);
  const header = `
    <div class="page-header">
      <h1 class="page__title"><span id="serverTitleText">${escapeHtml(formatServerTitle(serverName))}</span><span id="progressText">${escapeHtml(progressLabel)}</span></h1>
      ${renderServerDialogs()}
    </div>
    ${renderFilters(cards)}
    <div class="launch-overlay is-hidden" id="launchOverlay">
      <div class="launch-overlay__text">Нажмите в любом месте для возврата к списку игр</div>
    </div>
    <div class="row-break"></div>
  `;
  const items = displayCards.length > 0 ? displayCards.map(renderCard).join("") : renderEmptyState();

  grid.innerHTML = header + items;

  const filtersBar = document.getElementById("filtersBar");
  if (filtersBar) {
    filtersBar.addEventListener("click", handleFiltersClick);
    filtersBar.addEventListener("input", handleFiltersInput);
    filtersBar.addEventListener("keydown", handleFiltersKeydown);
  }

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
      showLaunchOverlay(5000);
      try {
        await withTimeout(invoke("launch_game", { productId }), 10_000, "Таймаут запуска");
      } catch (error) {
        cardEl.classList.remove("is-launching");
        activeLaunchCard = null;
        setStatus("Ошибка запуска", String(error), false);
      }
    });
  });

  queueGameFilterFocus();
}

function queueGameFilterFocus() {
  if (activeFilterDropdown !== "game") return;
  window.requestAnimationFrame(() => {
    const input = grid.querySelector("[data-filter-search='game']");
    if (!input) return;
    input.focus();
    const value = input.value || "";
    input.setSelectionRange(value.length, value.length);
  });
}

function handleFiltersClick(event) {
  const removeButton = event.target.closest("[data-filter-remove-game]");
  if (removeButton) {
    event.preventDefault();
    event.stopPropagation();
    const value = removeButton.dataset.filterRemoveGame || "";
    filters = {
      ...filters,
      games: filters.games.filter(game => game !== value)
    };
    render(allCards);
    return;
  }

  const option = event.target.closest("[data-filter-option]");
  if (option) {
    event.preventDefault();
    event.stopPropagation();
    const key = option.dataset.filterOption;
    const value = option.dataset.value || LICENSE_FILTERS.ANY;

    if (key === "game") {
      filters = {
        ...filters,
        games: filters.games.includes(value)
          ? filters.games.filter(game => game !== value)
          : [...filters.games, value]
      };
      activeFilterDropdown = "game";
      render(allCards);
      return;
    }

    if (key === "license") {
      filters = { ...filters, license: value };
    }

    if (key === "account") {
      filters = { ...filters, account: value };
    }

    activeFilterDropdown = null;
    gameFilterQuery = "";
    render(allCards);
    return;
  }

  const searchInput = event.target.closest("[data-filter-search='game']");
  if (searchInput) {
    event.stopPropagation();
    if (activeFilterDropdown !== "game") {
      activeFilterDropdown = "game";
      render(allCards);
    }
    return;
  }

  const toggle = event.target.closest("[data-filter-toggle]");
  if (!toggle) return;

  event.preventDefault();
  event.stopPropagation();
  const key = toggle.dataset.filterToggle;
  const nextDropdown = activeFilterDropdown === key ? null : key;
  activeFilterDropdown = nextDropdown;
  if (nextDropdown !== "game") {
    gameFilterQuery = "";
  }
  render(allCards);
}

function handleFiltersInput(event) {
  const input = event.target.closest("[data-filter-search='game']");
  if (!input) return;
  gameFilterQuery = input.value || "";
  activeFilterDropdown = "game";
  render(allCards);
}

function handleFiltersKeydown(event) {
  const input = event.target.closest("[data-filter-search='game']");
  if (!input) return;

  if (event.key === "Backspace" && !input.value && filters.games.length > 0) {
    event.preventDefault();
    filters = {
      ...filters,
      games: filters.games.slice(0, -1)
    };
    render(allCards);
  }
}

function renderLoading(count = 6) {
  const cards = Array.from({ length: count }, (_, index) => ({
    ...loadingCard,
    productId: `loading-${index + 1}`
  }));
  setCards(cards);
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
      setCards(cards || []);
    } catch (error) {
      loadingActive = false;
      setStatus("Ошибка загрузки данных", String(error), true);
      setProgressLabel("");
      setCards([fallbackDesktopCard]);
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
          setCards(cards);
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
      setCards(cards);
    })
    .catch(() => {
      setProgressLabel("");
      setStatus("Не удалось загрузить mock-data.json", "", true);
    });
}

window.__setCards = (cards, options) => setCards(cards, options);
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
