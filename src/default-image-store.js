const DB_NAME = "newtab-random-pixiv-images";
const DB_VERSION = 1;
const STORE_NAME = "assets";
export const DEFAULT_IMAGE_UPLOAD_KEY = "default-image-upload";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function withStore(mode, handler) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    tx.oncomplete = () => {
      db.close();
    };
    tx.onerror = () => {
      db.close();
      finish(reject, tx.error || new Error("IndexedDB transaction failed"));
    };
    tx.onabort = () => {
      db.close();
      finish(reject, tx.error || new Error("IndexedDB transaction aborted"));
    };

    Promise.resolve()
      .then(() => handler(store))
      .then((result) => finish(resolve, result))
      .catch((error) => {
        try {
          tx.abort();
        } catch (abortError) {
          void abortError;
        }
        finish(reject, error);
      });
  }));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export async function saveUploadedDefaultImage(data, uploadName = "") {
  const record = {
    id: DEFAULT_IMAGE_UPLOAD_KEY,
    uploadName,
    updatedAt: Date.now(),
  };
  if (data instanceof Blob) {
    record.blob = data;
    record.mimeType = data.type || "application/octet-stream";
  } else {
    record.dataUrl = data;
  }
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.put(record));
  });
  return record;
}

export function getUploadedDefaultImageRecord() {
  return withStore("readonly", (store) => requestToPromise(store.get(DEFAULT_IMAGE_UPLOAD_KEY)));
}

export function clearUploadedDefaultImage() {
  return withStore("readwrite", async (store) => {
    await requestToPromise(store.delete(DEFAULT_IMAGE_UPLOAD_KEY));
  });
}

function isLegacyEmbeddedUpload(config) {
  return config &&
    config.defaultImageSourceType === "upload" &&
    typeof config.defaultImageUrl === "string" &&
    config.defaultImageUrl.trim().startsWith("data:image/");
}

export async function resolveDefaultImageUrl(config, options = {}) {
  if (!config) return "";

  if (config.defaultImageSourceType === "upload") {
    if (isLegacyEmbeddedUpload(config)) {
      const legacyDataUrl = config.defaultImageUrl.trim();
      await saveUploadedDefaultImage(legacyDataUrl, config.defaultImageUploadName || "");
      if (typeof options.onLegacyMigrated === "function") {
        await options.onLegacyMigrated({ defaultImageUrl: "" });
      }
      return legacyDataUrl;
    }

    const record = await getUploadedDefaultImageRecord();
    if (!record) return "";
    if (typeof record.dataUrl === "string") {
      return record.dataUrl;
    }
    if (record.blob instanceof Blob) {
      return await blobToDataUrl(record.blob);
    }
    return "";
  }

  return typeof config.defaultImageUrl === "string"
    ? config.defaultImageUrl.trim()
    : "";
}
