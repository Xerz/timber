export function filterEnabledAvailable(items = []) {
  return items.filter(item => {
    if (!item || item.enabled !== true) return false;
    if (typeof item.available === "boolean") {
      return item.available === true;
    }
    const verified = item.verified ?? item.verified_status ?? item.verifiedStatus;
    if (verified == null || verified === "") return true;
    return String(verified).toUpperCase() === "READY";
  });
}

export function buildProductMap(products = []) {
  const map = new Map();
  for (const product of products) {
    if (product && product.productId) {
      map.set(product.productId, product);
    }
  }
  return map;
}

export function buildLaunchParams(details = {}) {
  const exePath = details.gamePath || details.game_path || details.defaultGamePath || "";
  const workDir = details.workPath || details.work_path || details.defaultWorkPath || "";
  const args = details.args || details.defaultArgs || "";
  return { exePath, workDir, args };
}

export const LICENSE_FILTERS = Object.freeze({
  ANY: "any",
  FREE: "free",
  PAID: "paid"
});

export function buildCards(enabledProducts = [], productMap = new Map()) {
  return enabledProducts.map(item => {
    const productId = item.productId || item.product_id || "";
    const meta = productMap.get(productId) || {};
    const title = meta.displayName || meta.title || item.title || "Игра";
    const descriptionRu = meta.descriptionRu || "";
    const alt = descriptionRu.length > 100 ? descriptionRu.slice(0, 100) : descriptionRu;
    const imageUrl = meta.cardPicture || "";
    const requiredAccount = meta.requiredAccount || "";
    const isFree = meta.noLicenseRequred === true;

    return {
      productId,
      title,
      imageUrl,
      alt,
      requiredAccount,
      isFree
    };
  });
}

export function buildCardFilterOptions(cards = []) {
  const games = new Set();
  const accounts = new Set();

  for (const card of cards) {
    const title = String(card?.title || "").trim();
    if (title) {
      games.add(title);
    }

    const account = String(card?.requiredAccount || "").trim();
    if (account) {
      accounts.add(account);
    }
  }

  return {
    games: [...games].sort(compareDisplayText),
    accounts: [...accounts].sort(compareDisplayText)
  };
}

export function applyCardFilters(cards = [], filters = {}) {
  const selectedGames = Array.isArray(filters.games)
    ? new Set(filters.games.map(value => String(value || "").trim()).filter(Boolean))
    : new Set();
  const selectedLicense = String(filters.license || LICENSE_FILTERS.ANY);
  const selectedAccount = String(filters.account || "").trim();

  return cards.filter(card => {
    const title = String(card?.title || "").trim();
    const account = String(card?.requiredAccount || "").trim();
    const isFree = card?.isFree === true;

    if (selectedGames.size > 0 && !selectedGames.has(title)) {
      return false;
    }

    if (selectedLicense === LICENSE_FILTERS.FREE && !isFree) {
      return false;
    }

    if (selectedLicense === LICENSE_FILTERS.PAID && isFree) {
      return false;
    }

    if (selectedAccount && selectedAccount !== LICENSE_FILTERS.ANY && account !== selectedAccount) {
      return false;
    }

    return true;
  });
}

function compareDisplayText(left, right) {
  return String(left).localeCompare(String(right), "ru", {
    sensitivity: "base",
    numeric: true
  });
}

export function buildFallbackDesktopCard() {
  return {
    productId: "desktop",
    title: "Рабочий стол",
    imageUrl: "",
    alt: "Доступ ко всему почти без ограничений.",
    requiredAccount: "",
    isFree: true
  };
}
