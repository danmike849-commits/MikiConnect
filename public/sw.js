self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'MikiConnect', body: 'New notification!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png'
    })
  );
});
