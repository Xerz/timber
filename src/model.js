export function filterEnabledAvailable(items = []) {
  return items.filter(item => item && item.enabled === true && item.available === true);
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
  const exePath = details.gamePath || details.defaultGamePath || "";
  const workDir = details.workPath || details.defaultWorkPath || "";
  const args = details.args || details.defaultArgs || "";
  return { exePath, workDir, args };
}

export function buildCards(enabledProducts = [], productMap = new Map()) {
  return enabledProducts.map(item => {
    const productId = item.productId || "";
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
