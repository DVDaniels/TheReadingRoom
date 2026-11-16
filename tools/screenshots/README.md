# App Store screenshots

Made from the real interface (src/) running in a browser with a pretend Rust side and made-up writers (data.py; every person, site and post is invented; no daviddaniels.com).

    pip install playwright pillow && playwright install chromium
    ./shootall.sh iphone ios 430 932 3
    ./shootall.sh ipad ios 1194 834 2
    ./shootall.sh mac macos 1280 800 2
    python3 frame.py iphone; python3 frame.py ipad; python3 frame.py mac   # final/<device>-1..6.png

Captions are in frame.py (SHOTS). Copy final/*.png to appstore/<version>/screenshots/; release.yml prepare uploads them.

Pictures in pics/: face-1..10.jpg are AI-generated faces (thispersondoesnotexist.com), not real people, one per
writer in data.py. tomatoes.jpg is "Heirloom tomatoes in a blue bowl on a wooden table" from Unsplash (Unsplash
License): https://unsplash.com/photos/heirloom-tomatoes-in-a-blue-bowl-on-a-wooden-table-BlAlRrC0w3w

appstore/ppo/<name>/ holds screenshots for a product page test (.github/workflows/ppo.yml).
