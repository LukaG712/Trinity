const encoder = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function u32(target: number[], value: number) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function appendBytes(target: number[], bytes: Uint8Array) {
  for (const byte of bytes) target.push(byte);
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function createWishlistZip(wishlist: unknown) {
  const entries = [
    { name: "wishlist.json", text: `${JSON.stringify(wishlist, null, 2)}\n` },
    { name: "README.txt", text: "Troved wishlist backup. The archive contains your data in wishlist.json. Keep this ZIP somewhere safe.\n" },
  ];
  const localParts: number[] = [];
  const centralParts: number[] = [];
  const { time, day } = dosDateTime(new Date());

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.text);
    const checksum = crc32(data);
    const offset = localParts.length;

    u32(localParts, 0x04034b50);
    u16(localParts, 20);
    u16(localParts, 0x0800);
    u16(localParts, 0);
    u16(localParts, time);
    u16(localParts, day);
    u32(localParts, checksum);
    u32(localParts, data.length);
    u32(localParts, data.length);
    u16(localParts, name.length);
    u16(localParts, 0);
    appendBytes(localParts, name);
    appendBytes(localParts, data);

    u32(centralParts, 0x02014b50);
    u16(centralParts, 20);
    u16(centralParts, 20);
    u16(centralParts, 0x0800);
    u16(centralParts, 0);
    u16(centralParts, time);
    u16(centralParts, day);
    u32(centralParts, checksum);
    u32(centralParts, data.length);
    u32(centralParts, data.length);
    u16(centralParts, name.length);
    u16(centralParts, 0);
    u16(centralParts, 0);
    u16(centralParts, 0);
    u16(centralParts, 0);
    u32(centralParts, 0);
    u32(centralParts, offset);
    appendBytes(centralParts, name);
  }

  const endParts: number[] = [];
  u32(endParts, 0x06054b50);
  u16(endParts, 0);
  u16(endParts, 0);
  u16(endParts, entries.length);
  u16(endParts, entries.length);
  u32(endParts, centralParts.length);
  u32(endParts, localParts.length);
  u16(endParts, 0);

  return new Blob([new Uint8Array([...localParts, ...centralParts, ...endParts])], { type: "application/zip" });
}

export function downloadWishlistZip(wishlist: unknown) {
  const url = URL.createObjectURL(createWishlistZip(wishlist));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `troved-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadWishlistJson(wishlist: unknown) {
  const blob = new Blob([`${JSON.stringify(wishlist, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wishlist.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
