(function () {
  const redirectHome = () => {
    window.location.replace("/index.html?redirected=true&t=" + Date.now());
  };

  fetch("/api/auth/get-session", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { "Accept": "application/json" },
  })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      const user = data && data.user;
      const role = String(user && user.role ? user.role : "").toLowerCase();
      if (!user || role !== "admin") {
        redirectHome();
      }
    })
    .catch(redirectHome);
})();
