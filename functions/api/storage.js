/**
 * Backblaze B2 Cloud Storage API (10GB Free Storage)
 * Bucket: zenstro (Bucket ID: cf2d1dae48585b43a31e0c17)
 * Capabilities:
 * - GET: List files, get 10GB storage usage stats & generate authenticated download URLs
 * - GET (?action=download): Stream/proxy file download
 * - POST: Upload file (multipart/form-data or binary)
 * - DELETE: Delete file version
 */

const B2_CONFIG = {
  keyId: "005fdde88b33ec70000000001",
  applicationKey: "K005vwk/rkMyzXMxiYG0U0Kt0YPdCzo",
  bucketId: "cf2d1dae48585b43a31e0c17",
  bucketName: "zenstro",
  maxQuotaBytes: 10 * 1024 * 1024 * 1024 // 10 GB
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getB2Auth(env) {
  const keyId = (env && env.B2_KEY_ID) || B2_CONFIG.keyId;
  const appKey = (env && env.B2_APPLICATION_KEY) || B2_CONFIG.applicationKey;
  const basicAuth = btoa(`${keyId}:${appKey}`);

  const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: {
      Authorization: `Basic ${basicAuth}`
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`B2 authorize failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

async function sha1Hex(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-1", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  try {
    const auth = await getB2Auth(env);
    const bucketId = (env && env.B2_BUCKET_ID) || B2_CONFIG.bucketId;
    const bucketName = (env && env.B2_BUCKET_NAME) || B2_CONFIG.bucketName;

    // Handle direct download proxy
    if (action === "download") {
      const fileName = url.searchParams.get("fileName");
      if (!fileName) {
        return new Response(JSON.stringify({ ok: false, error: "Missing fileName parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Generate download auth token valid for 24h
      const dlAuthRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_download_authorization`, {
        method: "POST",
        headers: {
          Authorization: auth.authorizationToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bucketId: bucketId,
          fileNamePrefix: fileName,
          validDurationInSeconds: 86400
        })
      });

      if (!dlAuthRes.ok) {
        return new Response(JSON.stringify({ ok: false, error: "Failed to generate download token" }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      const dlAuth = await dlAuthRes.json();
      const directUrl = `${auth.downloadUrl}/file/${bucketName}/${encodeURIComponent(fileName)}?Authorization=${encodeURIComponent(dlAuth.authorizationToken)}`;
      
      // Redirect to authorized download
      return Response.redirect(directUrl, 302);
    }

    // Default: List files & storage stats
    const maxFiles = parseInt(url.searchParams.get("limit") || "200", 10);
    const listRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        bucketId: bucketId,
        maxFileCount: maxFiles
      })
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      throw new Error(`b2_list_file_names failed: ${errText}`);
    }

    const listData = await listRes.json();

    // Generate download token for all listed files
    let dlToken = "";
    try {
      const dlTokenRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_download_authorization`, {
        method: "POST",
        headers: {
          Authorization: auth.authorizationToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bucketId: bucketId,
          fileNamePrefix: "",
          validDurationInSeconds: 604800 // 7 days
        })
      });
      if (dlTokenRes.ok) {
        const dlTokenData = await dlTokenRes.json();
        dlToken = dlTokenData.authorizationToken;
      }
    } catch (e) {
      console.warn("Could not get wildcard dlToken:", e);
    }

    let totalBytes = 0;
    const files = (listData.files || []).map(f => {
      totalBytes += (f.contentLength || 0);
      const encName = encodeURIComponent(f.fileName);
      const directUrl = dlToken
        ? `${auth.downloadUrl}/file/${bucketName}/${encName}?Authorization=${encodeURIComponent(dlToken)}`
        : `${auth.downloadUrl}/file/${bucketName}/${encName}`;

      return {
        fileId: f.fileId,
        fileName: f.fileName,
        contentLength: f.contentLength || 0,
        sizeFormatted: formatBytes(f.contentLength || 0),
        contentType: f.contentType || "application/octet-stream",
        uploadTimestamp: f.uploadTimestamp,
        uploadDate: new Date(f.uploadTimestamp).toISOString(),
        downloadUrl: directUrl,
        proxyUrl: `/api/storage?action=download&fileName=${encName}`
      };
    });

    // Sort by uploadTimestamp descending (newest first)
    files.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);

    const maxQuota = B2_CONFIG.maxQuotaBytes;
    const usedPercentage = Math.min(100, parseFloat(((totalBytes / maxQuota) * 100).toFixed(3)));
    const freeBytes = Math.max(0, maxQuota - totalBytes);

    return new Response(JSON.stringify({
      ok: true,
      bucketName: bucketName,
      bucketId: bucketId,
      downloadUrl: auth.downloadUrl,
      s3ApiUrl: auth.s3ApiUrl || "https://s3.us-east-005.backblazeb2.com",
      region: "us-east-005",
      files: files,
      totalFiles: files.length,
      totalBytes: totalBytes,
      maxBytes: maxQuota,
      usedFormatted: formatBytes(totalBytes),
      freeFormatted: formatBytes(freeBytes),
      maxFormatted: formatBytes(maxQuota),
      usedPercentage: usedPercentage
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const auth = await getB2Auth(env);
    const bucketId = (env && env.B2_BUCKET_ID) || B2_CONFIG.bucketId;
    const bucketName = (env && env.B2_BUCKET_NAME) || B2_CONFIG.bucketName;

    const contentType = request.headers.get("content-type") || "";

    // 1. Direct upload request (file in multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const fileEntry = formData.get("file");

      if (!fileEntry || typeof fileEntry === "string") {
        return new Response(JSON.stringify({ ok: false, error: "No file attached in form data" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const originalName = fileEntry.name || "upload-" + Date.now();
      const sanitizedName = originalName.replace(/[^a-zA-Z0-9._\-\/]/g, "_");
      const fileBuffer = await fileEntry.arrayBuffer();
      const sha1 = await sha1Hex(fileBuffer);
      const mime = fileEntry.type || "application/octet-stream";

      // Get upload URL from B2
      const upUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
        method: "POST",
        headers: {
          Authorization: auth.authorizationToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ bucketId: bucketId })
      });

      if (!upUrlRes.ok) {
        const errText = await upUrlRes.text();
        throw new Error(`b2_get_upload_url failed: ${errText}`);
      }

      const upUrlData = await upUrlRes.json();

      // Upload file directly to B2 upload URL
      const uploadRes = await fetch(upUrlData.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: upUrlData.authorizationToken,
          "X-Bz-File-Name": encodeURIComponent(sanitizedName),
          "Content-Type": mime,
          "Content-Length": String(fileBuffer.byteLength),
          "X-Bz-Content-Sha1": sha1
        },
        body: fileBuffer
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`B2 file upload failed: ${errText}`);
      }

      const uploadedFile = await uploadRes.json();

      return new Response(JSON.stringify({
        ok: true,
        message: "File uploaded successfully to Backblaze B2",
        file: {
          fileId: uploadedFile.fileId,
          fileName: uploadedFile.fileName,
          contentLength: uploadedFile.contentLength,
          sizeFormatted: formatBytes(uploadedFile.contentLength),
          downloadUrl: `${auth.downloadUrl}/file/${bucketName}/${encodeURIComponent(uploadedFile.fileName)}`
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Action: get_upload_credentials for large client-side uploads
    const body = await request.json().catch(() => ({}));
    if (body.action === "get_upload_url") {
      const upUrlRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
        method: "POST",
        headers: {
          Authorization: auth.authorizationToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ bucketId: bucketId })
      });

      if (!upUrlRes.ok) {
        throw new Error("Failed to get B2 upload URL");
      }

      const upUrlData = await upUrlRes.json();
      return new Response(JSON.stringify({
        ok: true,
        uploadUrl: upUrlData.uploadUrl,
        authorizationToken: upUrlData.authorizationToken,
        bucketName: bucketName
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Unsupported upload format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    let fileId = url.searchParams.get("fileId");
    let fileName = url.searchParams.get("fileName");

    if (!fileId || !fileName) {
      const body = await request.json().catch(() => ({}));
      fileId = fileId || body.fileId;
      fileName = fileName || body.fileName;
    }

    if (!fileId || !fileName) {
      return new Response(JSON.stringify({ ok: false, error: "fileId and fileName are required for deletion" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const auth = await getB2Auth(env);

    const delRes = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: "POST",
      headers: {
        Authorization: auth.authorizationToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fileId: fileId,
        fileName: fileName
      })
    });

    if (!delRes.ok) {
      const errText = await delRes.text();
      throw new Error(`b2_delete_file_version failed: ${errText}`);
    }

    const delData = await delRes.json();

    return new Response(JSON.stringify({
      ok: true,
      message: `File '${fileName}' deleted successfully`,
      fileId: delData.fileId,
      fileName: delData.fileName
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
