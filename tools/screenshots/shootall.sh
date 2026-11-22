#!/bin/bash
# usage: shootall.sh <prefix> <platform> <w> <h> <scale>
set -e
P=$1; PL=$2; W=$3; H=$4; S=$5
T='document.querySelector("[data-view=talk]").click(); await sleep(800);'
o="--platform $PL --w $W --h $H --scale $S"
python3 shoot.py $P-s1 "$T" $o >/dev/null
python3 shoot.py $P-s2 "$T document.querySelector('[data-talk=nbonly][data-k=talk]').click(); await sleep(600);" $o >/dev/null
python3 shoot.py $P-s3 "$T document.querySelector('[data-talk=nbwho][data-feed=\"3\"]').click(); await sleep(800);" $o >/dev/null
python3 shoot.py $P-s4 "$T document.querySelector('[data-open=\"6-keep-a-blogroll\"]').click(); await sleep(1200);" $o >/dev/null
python3 shoot.py $P-s5 "$T document.querySelector('[data-open=\"6-keep-a-blogroll\"]').click(); await sleep(1000); document.getElementById('rReply').click(); await sleep(600); document.querySelector('[data-reply-mail]').click(); await sleep(500); const b=document.getElementById('mcBody'); b.value='Hi Ben,\n\nYour post this morning got me to finally put a blogroll on my own site. Five people so far, and you are one of them.\n\nThank you for writing it.\n\nAlex' + b.value.replace(/^\s*\n/,'\n\n'); b.blur(); b.scrollTop=0;" $o --mail >/dev/null
python3 shoot.py $P-s6 "" $o >/dev/null
python3 shoot.py $P-s8 "document.querySelector('[data-view=people]').click(); await sleep(1000);" $o >/dev/null
# Writing (1.2.9): a made-up site, alexmoreno.net. Clicking Writing gives a blank page, so the post is typed in after.
SCR='const sc = el => { let n = el.parentElement; while (n && !(n.scrollHeight > n.clientHeight + 5 && getComputedStyle(n).overflowY !== "visible")) n = n.parentElement; return n || document.scrollingElement; };'
WS="$(cat wsteps.js) $SCR"
if [ "$P" = iphone ]; then
  python3 shoot.py $P-s7 "$WS const p=document.querySelector('.wr-new .wr-kinds'); const c=sc(p); c.scrollTop += p.getBoundingClientRect().top - 150; await sleep(300);" $o --site >/dev/null
else
  python3 shoot.py $P-s7 "$WS" $o --site >/dev/null
fi
