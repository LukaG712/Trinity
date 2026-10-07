type PermissionOptions = { mode: "readwrite" };
type WritableFile = { write(data: string): Promise<void>; close(): Promise<void> };
type WishrFileHandle = { getFile(): Promise<File>; createWritable(): Promise<WritableFile> };
export type WishrDirectoryHandle = {
  readonly name: string;
  queryPermission(options: PermissionOptions): Promise<PermissionState>;
  requestPermission(options: PermissionOptions): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WishrFileHandle>;
};
type PickerWindow = Window & { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<WishrDirectoryHandle> };

const DATABASE = "wishr-folder-storage";
const STORE = "settings";
const HANDLE_KEY = "wishlist-directory";
const WISHLIST_FILE = "wishlist.json";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open folder settings storage."));
  });
}

export function supportsDirectoryPicker() {
  return typeof (window as PickerWindow).showDirectoryPicker === "function";
}

export async function pickWishlistDirectory() {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("This browser does not support choosing a folder. Open Troved in a browser with direct folder access, such as a current version of Chrome or Edge.");
  return picker.call(window, { mode: "readwrite" });
}

export async function saveDirectoryHandle(handle: WishrDirectoryHandle) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(handle, HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not remember the selected folder."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not remember the selected folder."));
  }).finally(() => database.close());
}

export async function loadDirectoryHandle(): Promise<WishrDirectoryHandle | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).get(HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as WishrDirectoryHandle | undefined) || null);
    request.onerror = () => reject(request.error || new Error("Could not read the saved folder setting."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Could not read the saved folder setting.")); };
  });
}

export async function removeDirectoryHandle() {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear the saved folder setting."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not clear the saved folder setting."));
  }).finally(() => database.close());
}

export async function readWishlistFile(handle: WishrDirectoryHandle): Promise<unknown | null> {
  try {
    const fileHandle = await handle.getFileHandle(WISHLIST_FILE);
    return JSON.parse(await (await fileHandle.getFile()).text()) as unknown;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return null;
    throw error;
  }
}

export async function writeWishlistFile(handle: WishrDirectoryHandle, wishlist: unknown) {
  const fileHandle = await handle.getFileHandle(WISHLIST_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(`${JSON.stringify(wishlist, null, 2)}\n`);
  await writable.close();
}
