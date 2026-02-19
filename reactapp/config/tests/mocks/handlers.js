import { http, HttpResponse } from 'msw';

const handlers = [
  http.get('http://api.test/api/apps/nrds/', () => {
    return HttpResponse.json(
      {
        "title": "NRDS",
        "description": "This application helps to visualize the outputs of the model runs created by Next gen in a box and the DataStream",
        "tags": "",
        "package": "nrds",
        "urlNamespace": "nrds",
        "color": "",
        "icon": "/static/nrds/images/icon.png",
        "exitUrl": "/apps/",
        "rootUrl": "/apps/nrds/",
        "settingsUrl": "/admin/tethys_apps/tethysapp/999/change/"
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }),
  http.get('http://api.test/api/session/', () => {
    return HttpResponse.json(
      { 'isAuthenticated': true },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "sessionid=3mp52f19lnnrl1eeyb4b7xlxm9f2id8d; HttpOnly; Path=/; SameSite=Lax",
        },
      }
    );
  }),
  http.get('http://api.test/api/csrf/', () => {
    return HttpResponse.text('', {
      status: 200,
      headers: {
        "X-CSRFToken": "SxICmOkFldX4o4YVaySdZq9sgn0eRd3Ih6uFtY8BgU5tMyZc7n90oJ4M2My5i7cy",
      },
    });
  }),
  http.get('http://api.test/api/whoami/', () => {
    return HttpResponse.json(
      {
        "username": "jsmith",
        "firstName": "John",
        "lastName": "Smith",
        "email": "jsmith@tethys.org",
        "isAuthenticated": true,
        "isStaff": true
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }),
];

export { handlers };
