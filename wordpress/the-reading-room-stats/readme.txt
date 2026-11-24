=== The Reading Room stats ===
Contributors: dvdaniels
Tags: stats, rss, feed readers, analytics, privacy
Requires at least: 6.2
Tested up to: 7.2
Requires PHP: 7.4
Stable tag: 1.0.2
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

See your blog's visitors, RSS readers and search traffic in The Reading Room app. Counts without cookies or stored IP addresses.

== Description ==

The Reading Room is an RSS reader for Mac, iPhone and iPad for people who read and write on the indie web. Its Writing tab can show how your own blog is doing, under Your blog. This plugin is what it reads.

The plugin itself is free and counts on your own site whether or not you use the app. Writing, and Your blog in it, come with The Reading Room Plus, an optional subscription in the app.

**What it counts**

* **Visits:** a small script at the end of each page tells your site someone read it. No cookies, nothing stored in the browser, and robots that don't run scripts aren't counted. You (and anyone who can edit posts) aren't counted.
* **RSS readers:** when a feed reader checks your feed it says who it is. Online readers such as Feedly and Inoreader also say how many people follow you there. Apps on someone's own phone or computer count as one reader each.
* **Search traffic:** if you use Site Kit by Google with Search Console connected, your clicks, how often you show up in results, your average spot, and the searches you show up for.

**Privacy**

Each visitor is counted once a day using a one-way code made from their IP address and browser name mixed with a secret that changes every day. The IP address itself is never stored, and the codes are deleted the next day. Nothing is sent anywhere: the numbers stay in your WordPress database, and only signed-in people who can edit posts can read them. The plugin adds a suggested paragraph to Settings › Privacy for your privacy policy.

**Seeing it in the app**

1. In Users › Profile, make an application password called "The Reading Room".
2. In The Reading Room, connect your site under Settings › Your site, Mastodon & Bluesky with your username and that password.
3. Open Writing. Your blog's numbers show under Your blog. Counting starts the day you turn the plugin on.

== Frequently Asked Questions ==

= Does it work with page caching? =

Yes. Visits are counted by the script on the page, so cached pages still count.

= How accurate is the RSS reader count? =

It's an estimate. Online readers report their own subscriber counts; for apps on people's devices, each one that checks your feed in a day counts once. The app shows the highest count for each reader over the past week.

= Can I turn parts off? =

Yes, in Settings › The Reading Room stats.

= What happens when I delete the plugin? =

Its table and settings are removed.

== Changelog ==

= 1.0.2 =
* The numbers now show in the app's Writing tab (Your blog) instead of My Day; the readme and the settings page say so.

= 1.0.1 =
* Follows the WordPress.org plugin guidelines more closely: database queries name the table through a placeholder, the visit script is printed by WordPress, and everything uses the prefix trr_stats_. Needs WordPress 6.2 or later.

= 1.0.0 =
* First version: visits, top posts, RSS readers by app, Search Console through Site Kit.
