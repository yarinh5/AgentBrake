import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { HttpError } from "../contracts.js";
export const passwordParameters = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
let active = 0;
// One process-wide bound covers verification and creation across app instances.
// Reject excess work instead of keeping an unbounded queue of passwords in memory.
async function derive(password: string, salt: string): Promise<Buffer> {
    if (active >= 2)
        throw new HttpError(429, "Password service is busy. Try again shortly.");
    active++;
    try {
        return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, passwordParameters, (error, key) => error ? reject(error) : resolve(key)));
    }
    finally {
        active--;
    }
}
export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt)).toString("hex");
    return { salt, hash };
}
export async function verifyPassword(password: string, credential: {
    salt: string;
    hash: string;
}) {
    const key = await derive(password, credential.salt);
    const expected = Buffer.from(credential.hash, "hex");
    return key.length === expected.length && timingSafeEqual(key, expected);
}
