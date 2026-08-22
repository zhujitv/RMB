const TOKEN_KEY = "rmbMiniSessionToken";

function baseUrl() {
  return getApp().globalData.apiBaseUrl.replace(/\/$/, "");
}

function token() {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function businessMessage(payload, fallback) {
  return payload && (payload.message || payload.error) || fallback;
}

function handleUnauthorized(statusCode) {
  if (statusCode !== 401) return;
  wx.removeStorageSync(TOKEN_KEY);
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  if (currentPage && currentPage.route !== "pages/login/index") {
    wx.reLaunch({ url: "/pages/login/index" });
  }
}

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl()}${options.url}`,
      method: options.method || "GET",
      data: options.data,
      timeout: options.timeout || 30000,
      header: {
        "content-type": "application/json",
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(options.header || {}),
      },
      success(response) {
        handleUnauthorized(response.statusCode);
        const payload = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && payload.success !== false) resolve(payload);
        else reject(new Error(businessMessage(payload, `请求失败（${response.statusCode}）`)));
      },
      fail(error) { reject(new Error(error.errMsg || "网络请求失败")); },
    });
  });
}

function uploadSupplierDocument(requestId, documentType, filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl()}/api/supplier-document-requests/${requestId}/documents`,
      filePath,
      name: "file",
      formData: { documentType },
      timeout: 65000,
      header: token() ? { Authorization: `Bearer ${token()}` } : {},
      success(response) {
        handleUnauthorized(response.statusCode);
        let payload = {};
        try { payload = JSON.parse(response.data || "{}"); } catch {}
        if (response.statusCode >= 200 && response.statusCode < 300 && payload.success !== false) resolve(payload);
        else reject(new Error(businessMessage(payload, `上传失败（${response.statusCode}）`)));
      },
      fail(error) { reject(new Error(error.errMsg || "文件上传失败")); },
    });
  });
}

function downloadProtected(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: /^https:\/\//.test(url) ? url : `${baseUrl()}${url}`,
      header: token() ? { Authorization: `Bearer ${token()}` } : {},
      timeout: 60000,
      success(response) {
        handleUnauthorized(response.statusCode);
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.tempFilePath);
        else reject(new Error(`文件下载失败（${response.statusCode}）`));
      },
      fail(error) { reject(new Error(error.errMsg || "文件下载失败")); },
    });
  });
}

module.exports = {
  TOKEN_KEY,
  request,
  token,
  uploadSupplierDocument,
  downloadProtected,
};
