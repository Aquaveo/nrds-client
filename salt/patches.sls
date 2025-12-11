{% set TETHYS_PERSIST = salt['environ.get']('TETHYS_PERSIST') %}
{% set CSRF_TRUSTED_ORIGINS = salt['environ.get']('CSRF_TRUSTED_ORIGINS') %}
{% set MULTIPLE_APP_MODE = salt['environ.get']('MULTIPLE_APP_MODE') %}
{% set STANDALONE_APP = salt['environ.get']('STANDALONE_APP') %}

PATCH_Portal_Settings_TethysCore:
  cmd.run:
    - name: >
        tethys settings
        --set CSRF_TRUSTED_ORIGINS {{ CSRF_TRUSTED_ORIGINS }}
        --set MULTIPLE_APP_MODE {{ MULTIPLE_APP_MODE }}
        --set STANDALONE_APP {{ STANDALONE_APP }}
    - unless: /bin/bash -c "[ -f "{{ TETHYS_PERSIST }}/patch_complete" ];"

PATCH_NGINX_Config:
  cmd.run:
    - name: |
        sed -i '/proxy_pass http:\/\/channels-backend;/a\
            proxy_send_timeout    600s;\
            proxy_read_timeout    600s;' \
            {{ TETHYS_PERSIST }}/tethys_nginx.conf
    - unless: /bin/bash -c "[ -f "{{ TETHYS_PERSIST }}/patch_complete" ];"
    - shell: /bin/bash

Flag_Complete_Setup:
  cmd.run:
    - name: touch ${TETHYS_PERSIST}/patch_complete
    - shell: /bin/bash