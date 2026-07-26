import { prisma } from "../prisma";
import { formatIpGeolocation, resolveIpGeolocation } from "./ip-geolocation";
import { codedError, requireText } from "./shared-base-utils";
import { permissionError, type AccessUser } from "./shared-access";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { requireAuthName } from "./shared-auth-input";
import {
  type AuditRequestLike,
  type ActorLike,
  type UserInput,
  publicUser,
  resolveAvatarInitials,
} from "./shared-users-types";

export async function updateOwnProfile(request: AuditRequestLike, actor: ActorLike, input: UserInput = {}) {
  const actorId = requireText(actor?.id, "当前用户");
  const user = await prisma.user.findUnique({ where: { id: actorId } });
  if (!user || !user.isActive) throw permissionError("请先登录", 401);
  const name = requireAuthName(input.name);
  const englishName = String(input.englishName || "").trim().slice(0, 80);
  const avatarInitials = resolveAvatarInitials(input, name, user);
  const avatarUrl = normalizeAvatarUrl(input.avatarUrl);
  const requestedDefaultLanguage = String(input.defaultLanguage || "");
  const defaultLanguage = ["zh-CN", "en-US"].includes(requestedDefaultLanguage) ? requestedDefaultLanguage : null;
  const requestedDefaultHome = String(input.defaultHome || "welcome");
  const defaultHome = ["welcome", "dashboard", "orders", "payments", "costs", "domesticLogistics", "logisticsFees", "taxRefund", "reports", "manual"].includes(requestedDefaultHome)
    ? requestedDefaultHome
    : "welcome";
  const requestedPageSize = Number(input.pageSize || 20);
  const pageSize = [10, 20, 50].includes(requestedPageSize) ? requestedPageSize : 20;
  const loginAlertEnabled = input.loginAlertEnabled !== false;
  const before = publicUser(user);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      englishName: englishName || null,
      avatarInitials,
      avatarUrl,
      defaultLanguage,
      defaultHome,
      pageSize,
      loginAlertEnabled,
    },
  });
  await runNonCriticalTask("个人资料操作日志写入", () => writeAudit(request, actor, "修改本人资料", "users", user.id, before, publicUser(updated)));
  return publicUser(updated);
}

export const MAX_AVATAR_BYTES = 200 * 1024;

function avatarSignature(body: Buffer) {
  if (body.byteLength >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (body.byteLength >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "jpeg";
  if (body.byteLength >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return "";
}

export function normalizeAvatarUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > 300_000) throw codedError("头像文件过大，请选择更小的图片。", 400, "AVATAR_TOO_LARGE");
  const match = text.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || match[2].length % 4 !== 0) {
    throw codedError("头像仅支持 PNG、JPG 或 WebP 图片。", 400, "AVATAR_TYPE_INVALID");
  }
  const declaredType = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const body = Buffer.from(match[2], "base64");
  if (!body.byteLength) throw codedError("头像文件不能为空。", 400, "AVATAR_EMPTY");
  if (body.byteLength > MAX_AVATAR_BYTES) {
    throw codedError("头像文件过大，请选择不超过 200KB 的图片。", 400, "AVATAR_TOO_LARGE");
  }
  if (body.toString("base64") !== match[2]) {
    throw codedError("头像数据格式错误，请重新选择图片。", 400, "AVATAR_BASE64_INVALID");
  }
  const detectedType = avatarSignature(body);
  if (!detectedType || detectedType !== declaredType) {
    throw codedError("头像内容与图片类型不一致。", 400, "AVATAR_SIGNATURE_INVALID");
  }
  return `data:image/${detectedType};base64,${body.toString("base64")}`;
}

export function browserLabel(userAgent: string | null | undefined) {
  const ua = String(userAgent || "");
  if (!ua) return "未记录";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  if (/Firefox\//.test(ua)) return "Firefox";
  return "其他浏览器";
}

export function osLabel(userAgent: string | null | undefined) {
  const ua = String(userAgent || "");
  if (!ua) return "未记录";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/Linux/i.test(ua)) return "Linux";
  return "未知系统";
}

export function deviceBrowserLabel(userAgent: string | null | undefined) {
  if (!userAgent) return "未记录";
  return `${browserLabel(userAgent)} / ${osLabel(userAgent)}`;
}

export async function listOwnLoginRecords(actor: ActorLike, limit = 10) {
  const actorId = requireText(actor?.id, "当前用户");
  const rows = await prisma.loginAttempt.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 10, 1), 10),
    select: {
      id: true,
      createdAt: true,
      ipAddress: true,
      userAgent: true,
      failureReason: true,
      geoCountry: true,
      geoRegion: true,
      geoCity: true,
      geoIsp: true,
      geoSource: true,
      geoResolvedAt: true,
      success: true,
    },
  });
  const loginTimes = rows.map((row) => new Date(row.createdAt).getTime()).filter(Number.isFinite);
  const sessionRows = loginTimes.length
    ? await prisma.userSession.findMany({
      where: {
        userId: actorId,
        createdAt: {
          gte: new Date(Math.min(...loginTimes) - 5 * 60 * 1000),
          lte: new Date(Math.max(...loginTimes) + 5 * 60 * 1000),
        },
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        userAgent: true,
      },
      take: rows.length * 3,
    })
    : [];
  function fallbackSessionUserAgent(loginAt: Date | string) {
    const loginTime = new Date(loginAt).getTime();
    let best: { distance: number; userAgent: string } | null = null;
    for (const session of sessionRows) {
      if (!session.userAgent) continue;
      const distance = Math.abs(new Date(session.createdAt).getTime() - loginTime);
      if (distance > 5 * 60 * 1000) continue;
      if (!best || distance < best.distance) best = { distance, userAgent: session.userAgent };
    }
    return best?.userAgent || "";
  }
  return rows.map((row) => {
    const userAgent = row.userAgent || fallbackSessionUserAgent(row.createdAt);
    const storedGeo = {
      ipAddress: row.ipAddress || "",
      country: row.geoCountry || "",
      region: row.geoRegion || "",
      city: row.geoCity || "",
      isp: row.geoIsp || "",
      source: row.geoSource || "",
    };
    const geo = storedGeo.country || storedGeo.region || storedGeo.city || storedGeo.isp
      ? storedGeo
      : resolveIpGeolocation(row.ipAddress);
    return {
      id: row.id,
      loginAt: row.createdAt,
      ipAddress: row.ipAddress || "未记录",
      region: formatIpGeolocation(geo),
      geoCountry: geo.country || "",
      geoRegion: geo.region || "",
      geoCity: geo.city || "",
      geoIsp: geo.isp || "",
      geoSource: geo.source || "",
      geoResolvedAt: row.geoResolvedAt || null,
      browser: deviceBrowserLabel(userAgent),
      result: row.success ? "成功" : "失败",
      failureReason: row.failureReason || "",
    };
  });
}
