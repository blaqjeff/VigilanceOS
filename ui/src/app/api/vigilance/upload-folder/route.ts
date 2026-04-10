import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function slugify(value: string): string {
  const normalized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "uploaded-folder";
}

function sanitizeRelativePath(relativePath: string): string {
  const rawSegments = relativePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const safeSegments = rawSegments
    .filter((segment) => segment !== "." && segment !== "..")
    .map((segment) =>
      segment.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").slice(0, 120) || "file"
    );

  return safeSegments.join(path.sep);
}

export async function POST(req: Request) {
  let materializedDir: string | null = null;

  try {
    const form = await req.formData();
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const relativePaths = form
      .getAll("relativePaths")
      .map((value) => String(value));
    const roomId = String(form.get("roomId") ?? "").trim();
    const requestedName = String(form.get("displayName") ?? "").trim();

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "Select a folder before uploading it." },
        { status: 400 }
      );
    }

    const firstRelativePath = relativePaths[0] ?? files[0]?.name ?? "uploaded-folder";
    const detectedRoot = firstRelativePath.split(/[\\/]+/).filter(Boolean)[0] ?? "uploaded-folder";
    const folderLabel = slugify(requestedName || detectedRoot);

    const uploadRoot = path.join(/* turbopackIgnore: true */ process.cwd(), ".uploaded-targets");
    materializedDir = path.join(uploadRoot, `${Date.now()}-${folderLabel}`);
    await mkdir(materializedDir, { recursive: true });

    let wroteFiles = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relativePath = sanitizeRelativePath(relativePaths[index] ?? file.name);
      if (!relativePath) continue;

      const destination = path.join(materializedDir, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, new Uint8Array(await file.arrayBuffer()));
      wroteFiles += 1;
    }

    if (wroteFiles === 0) {
      throw new Error("The uploaded folder did not contain any readable files.");
    }

    const origin = new URL(req.url).origin;
    const createRes = await fetch(`${origin}/api/vigilance/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: materializedDir,
        roomId: roomId || undefined,
        displayName: `upload:${folderLabel}`,
        metadata: {
          systemManaged: true,
          uploadMode: "folder",
          originalRoot: detectedRoot,
          uploadedAt: new Date().toISOString(),
        },
      }),
      cache: "no-store",
    });

    const payload = await createRes.json().catch(() => null);
    if (!createRes.ok) {
      throw new Error(payload?.error ?? "Uploaded folder could not be queued.");
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (error: any) {
    if (materializedDir) {
      await rm(materializedDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Folder upload failed.",
      },
      { status: 500 }
    );
  }
}
