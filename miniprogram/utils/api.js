const app = getApp();

function rememberCurrentPage() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (!current || current.route === "pages/login/index") return;
  const query = Object.keys(current.options || {})
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(current.options[key])}`)
    .join("&");
  wx.setStorageSync("nextwoodMiniRedirect", `/${current.route}${query ? `?${query}` : ""}`);
}

function request(path, options = {}) {
  const token = app.token();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBase}${path}`,
      method: options.method || "GET",
      data: options.data,
      timeout: 20000,
      header: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(response) {
        const data = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
          return;
        }
        if (response.statusCode === 401) {
          rememberCurrentPage();
          app.clearSession();
          wx.reLaunch({ url: "/pages/login/index" });
        }
        reject(new Error(data.error || data.message || "请求失败"));
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络连接失败"));
      },
    });
  });
}

module.exports = { request };
