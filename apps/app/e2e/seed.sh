#!/bin/sh
# Sends the messages the flows expect between bob and alice over the plain submission port.
set -eu
send() {
  from=${1:-bob} to=${2:-alice}
  curl -sS --fail smtp://127.0.0.1:1587 -u "$from@mailbowox.test:mailbowox-dev" \
    --mail-from "$from@mailbowox.test" --mail-rcpt "$to@mailbowox.test" --upload-file -
}

send <<'EOF'
From: Bob <bob@mailbowox.test>
To: Alice <alice@mailbowox.test>
Subject: Lunch on Friday
Content-Type: text/plain; charset=utf-8

Shall we try the new ramen place at noon?
EOF

send <<'EOF'
From: Bob <bob@mailbowox.test>
To: Alice <alice@mailbowox.test>
Subject: Quarterly numbers
Content-Type: text/html; charset=utf-8

<p>The report is ready.</p><img src="https://tracker.example/pixel.gif" width="1" height="1">
EOF

send <<'EOF'
From: Bob <bob@mailbowox.test>
To: Alice <alice@mailbowox.test>
Subject: Trip plan
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary=plan

--plan
Content-Type: text/plain; charset=utf-8

The plan is attached.
--plan
Content-Type: text/plain; charset=utf-8; name=plan.txt
Content-Disposition: attachment; filename=plan.txt

Day one: the coast. Day two: the hills.
--plan--
EOF

send alice bob <<'EOF'
From: Alice <alice@mailbowox.test>
To: Bob <bob@mailbowox.test>
Subject: Weekend hike
Content-Type: text/plain; charset=utf-8

Saturday at eight, from the station. Bring water.
EOF

curl -sS --fail -X PUT -u alice@mailbowox.test:mailbowox-dev -H 'Content-Type: text/vcard; charset=utf-8' \
  http://127.0.0.1:18080/dav/card/alice%40mailbowox.test/default/elodie-marchand.vcf --data-binary @- <<'EOF' >/dev/null
BEGIN:VCARD
VERSION:3.0
UID:elodie-marchand@mailbowox.test
FN:Élodie Marchand
N:Marchand;Élodie;;;
ORG:Marchand Atelier
EMAIL;TYPE=INTERNET,WORK:elodie.marchand@atelier.test
TEL;TYPE=CELL:+33 6 12 34 56 78
END:VCARD
EOF
