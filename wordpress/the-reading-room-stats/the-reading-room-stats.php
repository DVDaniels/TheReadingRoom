<?php
/**
 * Plugin Name:       The Reading Room stats
 * Plugin URI:        https://readingroomapp.com/plugin/
 * Description:       Shows your blog's visitors, RSS readers and search traffic in The Reading Room app (My Day › Your blog). Counts visits without cookies and without storing IP addresses.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            David Daniels
 * Author URI:        https://readingroomapp.com/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       the-reading-room-stats
 */

defined( 'ABSPATH' ) || exit;

define( 'RRS_VERSION', '1.0.0' );
define( 'RRS_DB_VERSION', 1 );
define( 'RRS_KEEP_DAYS', 70 );   // a little more than two 28-day windows
define( 'RRS_WINDOW', 28 );

/* ------------------------------------------------------------------------------------------------
 * Storage: one small table of daily counts.
 *   kind 'view'  item ''        page views that day
 *   kind 'uniq'  item ''        visitors that day (each counted once a day)
 *   kind 'seen'  item <hash>    today's visitor hashes, so a visitor counts once; deleted the next day
 *   kind 'post'  item <post id> views of one post or page that day
 *   kind 'subs'  item <reader>  subscribers a feed reader reported that day (the highest it said)
 *   kind 'rdr'   item <reader>  apps and devices of that reader that checked the feed that day
 *   kind 'fseen' item <hash>    today's feed checkers, so each counts once; deleted the next day
 * ------------------------------------------------------------------------------------------------ */

function rrs_table() {
	global $wpdb;
	return $wpdb->prefix . 'reading_room_stats';
}

function rrs_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$t = rrs_table();
	$c = $wpdb->get_charset_collate();
	dbDelta( "CREATE TABLE $t (
  day date NOT NULL,
  kind varchar(8) NOT NULL,
  item varchar(64) NOT NULL DEFAULT '',
  n bigint(20) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (day,kind,item)
) $c;" );
	update_option( 'rrs_db_version', RRS_DB_VERSION, false );
	if ( ! get_option( 'rrs_since' ) ) {
		update_option( 'rrs_since', current_time( 'Y-m-d' ), false );
	}
	if ( ! wp_next_scheduled( 'rrs_daily' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'rrs_daily' );
	}
}
register_activation_hook( __FILE__, 'rrs_install' );

register_deactivation_hook( __FILE__, function () {
	wp_clear_scheduled_hook( 'rrs_daily' );
} );

add_action( 'plugins_loaded', function () {
	if ( (int) get_option( 'rrs_db_version' ) < RRS_DB_VERSION ) {
		rrs_install();
	}
} );

// Add to a day's count (creates the row the first time).
function rrs_add( $kind, $item = '', $by = 1, $day = null ) {
	global $wpdb;
	$day = $day ? $day : current_time( 'Y-m-d' );
	$wpdb->query( $wpdb->prepare(
		'INSERT INTO ' . rrs_table() . ' (day, kind, item, n) VALUES (%s, %s, %s, %d) ON DUPLICATE KEY UPDATE n = n + %d',
		$day, $kind, substr( (string) $item, 0, 64 ), $by, $by
	) );
}

// Keep the highest number a reader reported that day.
function rrs_max( $kind, $item, $n ) {
	global $wpdb;
	$wpdb->query( $wpdb->prepare(
		'INSERT INTO ' . rrs_table() . ' (day, kind, item, n) VALUES (%s, %s, %s, %d) ON DUPLICATE KEY UPDATE n = GREATEST(n, %d)',
		current_time( 'Y-m-d' ), $kind, substr( (string) $item, 0, 64 ), $n, $n
	) );
}

// True the first time this hash shows up today.
function rrs_first_today( $kind, $hash ) {
	global $wpdb;
	$wpdb->query( $wpdb->prepare(
		'INSERT IGNORE INTO ' . rrs_table() . ' (day, kind, item, n) VALUES (%s, %s, %s, 1)',
		current_time( 'Y-m-d' ), $kind, $hash
	) );
	return 1 === (int) $wpdb->rows_affected;
}

// A one-way code for "this browser today": the address and browser name mixed with a secret that changes
// every day. The address itself is never written down, and yesterday's codes are deleted.
function rrs_hash( $extra = '' ) {
	$day  = current_time( 'Y-m-d' );
	$salt = get_option( 'rrs_salt' );
	if ( ! is_array( $salt ) || ( $salt['day'] ?? '' ) !== $day ) {
		$salt = array( 'day' => $day, 'key' => wp_generate_password( 32, true, true ) );
		update_option( 'rrs_salt', $salt, false );
	}
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
	return substr( hash_hmac( 'sha256', $ip . '|' . $ua . '|' . $extra, $salt['key'] ), 0, 20 );
}

// Once a day: drop yesterday's hashes and anything older than RRS_KEEP_DAYS.
add_action( 'rrs_daily', 'rrs_cleanup' );
function rrs_cleanup() {
	global $wpdb;
	$t     = rrs_table();
	$today = current_time( 'Y-m-d' );
	$old   = gmdate( 'Y-m-d', strtotime( $today . ' -' . RRS_KEEP_DAYS . ' days' ) );
	$wpdb->query( $wpdb->prepare( "DELETE FROM $t WHERE kind IN ('seen', 'fseen') AND day < %s", $today ) );
	$wpdb->query( $wpdb->prepare( "DELETE FROM $t WHERE day < %s", $old ) );
}

function rrs_on( $what ) {
	$o = get_option( 'rrs_settings', array() );
	return ! isset( $o[ $what ] ) || $o[ $what ];
}

/* ------------------------------------------------------------------------------------------------
 * Visits. A tiny script at the end of each page tells the site "someone read this". It works behind
 * page caches, and robots that don't run scripts aren't counted. No cookies, nothing stored in the
 * browser. People signed in who can edit posts (you) aren't counted.
 * ------------------------------------------------------------------------------------------------ */

add_action( 'wp_footer', function () {
	if ( ! rrs_on( 'visits' ) || is_preview() || is_404() || is_feed() || current_user_can( 'edit_posts' ) ) {
		return;
	}
	$id  = is_singular() ? (int) get_queried_object_id() : 0;
	$url = esc_url_raw( rest_url( 'reading-room/v1/hit' ) );
	printf(
		"<script>(function(){if(navigator.webdriver)return;var b=JSON.stringify({p:%d});try{navigator.sendBeacon?navigator.sendBeacon(%s,new Blob([b],{type:'application/json'})):fetch(%s,{method:'POST',body:b,headers:{'Content-Type':'application/json'},keepalive:true});}catch(e){}})();</script>\n",
		$id,
		wp_json_encode( $url ),
		wp_json_encode( $url )
	);
}, 99 );

function rrs_is_bot() {
	$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? strtolower( sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) ) : '';
	return '' === $ua || (bool) preg_match( '/bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|python|curl|wget|httpclient|java\/|go-http|scrapy/', $ua );
}

function rrs_hit( WP_REST_Request $req ) {
	if ( ! rrs_on( 'visits' ) || rrs_is_bot() || current_user_can( 'edit_posts' ) ) {
		return new WP_REST_Response( null, 204 );
	}
	$p = (int) $req->get_param( 'p' );
	if ( $p && 'publish' !== get_post_status( $p ) ) {
		$p = 0;
	}
	rrs_add( 'view' );
	if ( rrs_first_today( 'seen', rrs_hash() ) ) {
		rrs_add( 'uniq' );
	}
	if ( $p ) {
		rrs_add( 'post', (string) $p );
	}
	return new WP_REST_Response( null, 204 );
}

/* ------------------------------------------------------------------------------------------------
 * Feed readers. When a reader checks your feed it says who it is, and the big online ones also say
 * how many people follow you there ("Feedly ... 42 subscribers"). For those we keep the number they
 * report; for apps on someone's own phone or computer, each one that checks counts as one reader.
 * ------------------------------------------------------------------------------------------------ */

function rrs_readers() {
	// pattern => name shown in the app
	return array(
		'feedly'          => 'Feedly',
		'inoreader'       => 'Inoreader',
		'newsblur'        => 'NewsBlur',
		'feedbin'         => 'Feedbin',
		'theoldreader'    => 'The Old Reader',
		'old reader'      => 'The Old Reader',
		'feedspot'        => 'Feedspot',
		'bazqux'          => 'BazQux',
		'feedhq'          => 'FeedHQ',
		'feedwrangler'    => 'Feed Wrangler',
		'bloglovin'       => 'Bloglovin',
		'micro.blog'      => 'Micro.blog',
		'readwise'        => 'Readwise Reader',
		'reading room'    => 'The Reading Room',
		'readingroom'     => 'The Reading Room',
		'netnewswire'     => 'NetNewsWire',
		'reeder'          => 'Reeder',
		'unread'          => 'Unread',
		'readkit'         => 'ReadKit',
		'fiery feeds'     => 'Fiery Feeds',
		'feeeed'          => 'feeeed',
		'lire'            => 'lire',
		'vienna'          => 'Vienna',
		'newsflash'       => 'NewsFlash',
		'thunderbird'     => 'Thunderbird',
		'akregator'       => 'Akregator',
		'liferea'         => 'Liferea',
		'feeder'          => 'Feeder',
		'feedbro'         => 'Feedbro',
		'miniflux'        => 'Miniflux',
		'freshrss'        => 'FreshRSS',
		'tiny tiny rss'   => 'Tiny Tiny RSS',
		'tt-rss'          => 'Tiny Tiny RSS',
		'nextcloud-news'  => 'Nextcloud News',
		'commafeed'       => 'CommaFeed',
		'yarr'            => 'yarr',
		'feedreader'      => 'FeedReader',
		'rss guard'       => 'RSS Guard',
		'rssguard'        => 'RSS Guard',
		'newsboat'        => 'Newsboat',
		'feedburner'      => 'FeedBurner',
	);
}

add_action( 'template_redirect', function () {
	if ( ! rrs_on( 'feeds' ) || ! is_feed() || is_comment_feed() ) {
		return;
	}
	$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
	if ( '' === $ua ) {
		return;
	}
	$low  = strtolower( $ua );
	$name = '';
	foreach ( rrs_readers() as $needle => $label ) {
		if ( false !== strpos( $low, $needle ) ) {
			$name = $label;
			break;
		}
	}
	if ( preg_match( '/(\d+)\s+(subscribers?|readers?|followers?)/i', $ua, $m ) ) {
		rrs_max( 'subs', $name ? $name : 'Other online readers', (int) $m[1] );
		return;
	}
	// Search engines and site checkers aren't readers.
	if ( ! $name && preg_match( '/googlebot|bingbot|yandex|baidu|duckduck|semrush|ahrefs|mj12|petal|monitor|uptime|validator|wordpress\/|jetpack/', $low ) ) {
		return;
	}
	$name = $name ? $name : 'Other apps';
	if ( rrs_first_today( 'fseen', rrs_hash( 'feed' ) ) ) {
		rrs_add( 'rdr', $name );
	}
}, 1 );

/* ------------------------------------------------------------------------------------------------
 * Search traffic: Google Search Console, read through Site Kit by Google when the site has it
 * connected. Without Site Kit this part is simply left out.
 * ------------------------------------------------------------------------------------------------ */

function rrs_search_console( $start, $end, $dimension, $limit ) {
	if ( ! defined( 'GOOGLESITEKIT_VERSION' ) ) {
		return null;
	}
	$req = new WP_REST_Request( 'GET', '/google-site-kit/v1/modules/search-console/data/searchanalytics' );
	$req->set_query_params( array(
		'startDate'  => $start,
		'endDate'    => $end,
		'dimensions' => $dimension,
		'limit'      => $limit,
	) );
	$res = rest_do_request( $req );
	if ( $res->is_error() || 200 !== $res->get_status() ) {
		return null;
	}
	$rows = $res->get_data();
	if ( isset( $rows['rows'] ) ) {
		$rows = $rows['rows'];
	}
	return is_array( $rows ) ? $rows : null;
}

function rrs_search() {
	$cached = get_transient( 'rrs_search' );
	if ( false !== $cached ) {
		return $cached ? $cached : null;
	}
	$today = current_time( 'Y-m-d' );
	$end   = gmdate( 'Y-m-d', strtotime( $today . ' -2 days' ) ); // Search Console runs a couple of days behind
	$start = gmdate( 'Y-m-d', strtotime( $end . ' -' . ( RRS_WINDOW - 1 ) . ' days' ) );
	$pend  = gmdate( 'Y-m-d', strtotime( $start . ' -1 day' ) );
	$pst   = gmdate( 'Y-m-d', strtotime( $pend . ' -' . ( RRS_WINDOW - 1 ) . ' days' ) );
	$now   = rrs_search_console( $start, $end, 'date', 100 );
	$out   = null;
	if ( is_array( $now ) ) {
		$clicks = 0;
		$impr   = 0;
		$pos    = 0;
		foreach ( $now as $r ) {
			$clicks += (int) ( $r['clicks'] ?? 0 );
			$impr   += (int) ( $r['impressions'] ?? 0 );
			$pos    += (float) ( $r['position'] ?? 0 ) * (int) ( $r['impressions'] ?? 0 );
		}
		$before = rrs_search_console( $pst, $pend, 'date', 100 );
		$prev   = null;
		if ( is_array( $before ) ) {
			$prev = 0;
			foreach ( $before as $r ) {
				$prev += (int) ( $r['clicks'] ?? 0 );
			}
		}
		$queries = array();
		foreach ( (array) rrs_search_console( $start, $end, 'query', 10 ) as $r ) {
			if ( ! empty( $r['keys'][0] ) ) {
				$queries[] = array(
					'q'      => (string) $r['keys'][0],
					'clicks' => (int) ( $r['clicks'] ?? 0 ),
					'pos'    => round( (float) ( $r['position'] ?? 0 ), 1 ),
				);
			}
		}
		$out = array(
			'clicks'      => $clicks,
			'prevClicks'  => $prev,
			'impressions' => $impr,
			'position'    => $impr ? round( $pos / $impr, 1 ) : 0,
			'window'      => RRS_WINDOW,
			'through'     => $end,
			'queries'     => $queries,
		);
	}
	set_transient( 'rrs_search', $out ? $out : 0, 3 * HOUR_IN_SECONDS );
	return $out;
}

/* ------------------------------------------------------------------------------------------------
 * What the app reads: GET /wp-json/reading-room/v1/stats, for people who can edit posts on this site
 * (the app signs in with a WordPress application password).
 * ------------------------------------------------------------------------------------------------ */

function rrs_sum( $kind, $from, $to ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare(
		'SELECT COALESCE(SUM(n), 0) FROM ' . rrs_table() . ' WHERE kind = %s AND day BETWEEN %s AND %s',
		$kind, $from, $to
	) );
}

// For each reader, the highest daily count in the 7 days ending $to; the total is the sum.
function rrs_feed_readers( $to ) {
	global $wpdb;
	$from = gmdate( 'Y-m-d', strtotime( $to . ' -6 days' ) );
	$rows = $wpdb->get_results( $wpdb->prepare(
		'SELECT item, MAX(n) AS n FROM ' . rrs_table() . " WHERE kind IN ('subs', 'rdr') AND day BETWEEN %s AND %s GROUP BY item",
		$from, $to
	) );
	$apps = array();
	foreach ( (array) $rows as $r ) {
		$apps[ $r->item ] = ( $apps[ $r->item ] ?? 0 ) + (int) $r->n;
	}
	arsort( $apps );
	return $apps;
}

function rrs_stats() {
	global $wpdb;
	$t     = rrs_table();
	$today = current_time( 'Y-m-d' );
	$day   = function ( $n ) use ( $today ) {
		return gmdate( 'Y-m-d', strtotime( $today . ' ' . $n . ' days' ) );
	};
	$since = (string) get_option( 'rrs_since', $today );
	$out   = array(
		'site'    => wp_parse_url( home_url(), PHP_URL_HOST ),
		'at'      => time() * 1000,
		'plugin'  => RRS_VERSION,
	);

	if ( rrs_on( 'visits' ) ) {
		$start = $day( -( RRS_WINDOW - 1 ) );
		$days  = array();
		$per   = $wpdb->get_results( $wpdb->prepare( "SELECT day, n FROM $t WHERE kind = 'uniq' AND day >= %s", $day( -13 ) ), OBJECT_K );
		for ( $i = 13; $i >= 0; $i-- ) {
			$d      = $day( -$i );
			$days[] = array( 'd' => $d, 'n' => isset( $per[ $d ] ) ? (int) $per[ $d ]->n : 0 );
		}
		$prev_from = $day( -( 2 * RRS_WINDOW - 1 ) );
		$top       = array();
		$rows      = $wpdb->get_results( $wpdb->prepare( "SELECT item, SUM(n) AS n FROM $t WHERE kind = 'post' AND day >= %s GROUP BY item ORDER BY n DESC LIMIT 5", $start ) );
		foreach ( (array) $rows as $r ) {
			$p = get_post( (int) $r->item );
			if ( $p && 'publish' === $p->post_status ) {
				$top[] = array( 'title' => html_entity_decode( get_the_title( $p ), ENT_QUOTES, 'UTF-8' ), 'url' => get_permalink( $p ), 'n' => (int) $r->n );
			}
		}
		$out['visitors'] = array(
			'total'   => rrs_sum( 'uniq', $start, $today ),
			'prev'    => $since <= $prev_from ? rrs_sum( 'uniq', $prev_from, $day( -RRS_WINDOW ) ) : null,
			'views'   => rrs_sum( 'view', $start, $today ),
			'window'  => RRS_WINDOW,
			'through' => $today,
			'since'   => $since,
			'days'    => $days,
			'label'   => 'visits',
			'source'  => 'Counted on your site by The Reading Room stats, without cookies',
		);
		$out['top'] = array_slice( $top, 0, 3 );
	}

	if ( rrs_on( 'feeds' ) ) {
		$apps = rrs_feed_readers( $today );
		$list = array();
		foreach ( $apps as $name => $n ) {
			$list[] = array( 'name' => $name, 'n' => $n );
		}
		$week_ago = $day( -7 );
		$prev     = null;
		if ( $since <= $day( -13 ) ) {
			$prev = array_sum( rrs_feed_readers( $week_ago ) );
		}
		$out['rss'] = array(
			'total' => array_sum( $apps ),
			'prev'  => $prev,
			'since' => $since,
			'apps'  => $list,
		);
	}

	if ( rrs_on( 'search' ) ) {
		$s = rrs_search();
		if ( $s ) {
			$out['search'] = $s;
		}
	}
	return $out;
}

add_action( 'rest_api_init', function () {
	// A site that already has its own reading-room/v1/stats (an older code snippet) keeps it.
	$routes = rest_get_server()->get_routes( 'reading-room/v1' );
	if ( ! isset( $routes['/reading-room/v1/stats'] ) ) {
		register_rest_route( 'reading-room/v1', '/stats', array(
			'methods'             => 'GET',
			'callback'            => function () {
				$r = new WP_REST_Response( rrs_stats() );
				$r->header( 'Cache-Control', 'no-store' );
				return $r;
			},
			'permission_callback' => function () {
				return current_user_can( 'edit_posts' );
			},
		) );
	}
	register_rest_route( 'reading-room/v1', '/hit', array(
		'methods'             => 'POST',
		'callback'            => 'rrs_hit',
		'permission_callback' => '__return_true',
		'args'                => array( 'p' => array( 'type' => 'integer', 'default' => 0 ) ),
	) );
}, 20 );

/* ------------------------------------------------------------------------------------------------
 * Some hosts drop the Authorization header before WordPress sees it, which breaks application
 * passwords. The app also sends the same sign-in as X-Reading-Room-Auth; hand that to WordPress.
 * ------------------------------------------------------------------------------------------------ */

add_filter( 'determine_current_user', function ( $user ) {
	if ( ! empty( $_SERVER['PHP_AUTH_USER'] ) || empty( $_SERVER['HTTP_X_READING_ROOM_AUTH'] ) ) {
		return $user;
	}
	$h = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_READING_ROOM_AUTH'] ) );
	if ( 0 === stripos( $h, 'Basic ' ) ) {
		$pair = base64_decode( substr( $h, 6 ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		if ( $pair && false !== strpos( $pair, ':' ) ) {
			list( $u, $p ) = explode( ':', $pair, 2 );
			$_SERVER['PHP_AUTH_USER'] = $u;
			$_SERVER['PHP_AUTH_PW']   = $p;
		}
	}
	return $user;
}, 5 );

/* ------------------------------------------------------------------------------------------------
 * Settings › The Reading Room stats: what's being counted, and switches for each part.
 * ------------------------------------------------------------------------------------------------ */

add_action( 'admin_menu', function () {
	add_options_page( 'The Reading Room stats', 'The Reading Room stats', 'manage_options', 'reading-room-stats', 'rrs_settings_page' );
} );

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=reading-room-stats' ) ) . '">' . esc_html__( 'Settings', 'the-reading-room-stats' ) . '</a>' );
	return $links;
} );

function rrs_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	if ( isset( $_POST['rrs_save'] ) && check_admin_referer( 'rrs_save' ) ) {
		update_option( 'rrs_settings', array(
			'visits' => ! empty( $_POST['visits'] ),
			'feeds'  => ! empty( $_POST['feeds'] ),
			'search' => ! empty( $_POST['search'] ),
		), false );
		delete_transient( 'rrs_search' );
		echo '<div class="notice notice-success"><p>' . esc_html__( 'Saved.', 'the-reading-room-stats' ) . '</p></div>';
	}
	$s     = rrs_stats();
	$v     = $s['visitors'] ?? null;
	$r     = $s['rss'] ?? null;
	$since = get_option( 'rrs_since' );
	$sk    = defined( 'GOOGLESITEKIT_VERSION' );
	?>
	<div class="wrap">
		<h1>The Reading Room stats</h1>
		<p style="max-width:44em">This plugin lets <a href="https://readingroomapp.com/">The Reading Room</a> show your blog's visitors, RSS readers and search traffic on its My Day page. It counts on your own site, without cookies, and never stores visitors' IP addresses. Only people who can edit posts here can see the numbers.</p>
		<h2>So far</h2>
		<table class="widefat striped" style="max-width:44em">
			<tbody>
				<tr><td>Counting since</td><td><?php echo esc_html( $since ? date_i18n( get_option( 'date_format' ), strtotime( $since ) ) : '—' ); ?></td></tr>
				<tr><td>Visits, last <?php echo (int) RRS_WINDOW; ?> days</td><td><?php echo $v ? esc_html( number_format_i18n( $v['total'] ) ) . ' (' . esc_html( number_format_i18n( $v['views'] ) ) . ' page views)' : 'Off'; ?></td></tr>
				<tr><td>RSS readers</td><td><?php
					if ( ! $r ) {
						echo 'Off';
					} else {
						echo esc_html( number_format_i18n( $r['total'] ) );
						if ( $r['apps'] ) {
							echo ' — ' . esc_html( implode( ', ', array_map( function ( $a ) {
								return $a['name'] . ' ' . $a['n'];
							}, array_slice( $r['apps'], 0, 6 ) ) ) );
						}
					}
				?></td></tr>
				<tr><td>Search</td><td><?php echo isset( $s['search'] ) ? esc_html( number_format_i18n( $s['search']['clicks'] ) ) . ' clicks from Google' : ( $sk ? 'Site Kit is installed, but Search Console data isn\'t available yet. Connect Search Console in Site Kit.' : 'Install Site Kit by Google and connect Search Console to see search traffic.' ); ?></td></tr>
			</tbody>
		</table>
		<h2>What to count</h2>
		<form method="post">
			<?php wp_nonce_field( 'rrs_save' ); ?>
			<p><label><input type="checkbox" name="visits" value="1" <?php checked( rrs_on( 'visits' ) ); ?>> Visits (a small script at the end of each page; no cookies)</label></p>
			<p><label><input type="checkbox" name="feeds" value="1" <?php checked( rrs_on( 'feeds' ) ); ?>> Feed readers (from what readers say when they check your feed)</label></p>
			<p><label><input type="checkbox" name="search" value="1" <?php checked( rrs_on( 'search' ) ); ?>> Search traffic from Google Search Console, through Site Kit</label></p>
			<p><button class="button button-primary" name="rrs_save" value="1">Save</button></p>
		</form>
		<h2>Seeing it in the app</h2>
		<ol style="max-width:44em">
			<li>In your profile here (Users › Profile), make an <strong>application password</strong> called "The Reading Room".</li>
			<li>In The Reading Room, open Settings › Your site, Mastodon &amp; Bluesky and connect this site with your username and that password.</li>
			<li>Open <strong>My Day</strong>. Your blog's numbers show under the calendar and markets. New counts start today, so give it a few days.</li>
		</ol>
	</div>
	<?php
}

// A line for the site's privacy policy (Settings › Privacy).
add_action( 'admin_init', function () {
	if ( function_exists( 'wp_add_privacy_policy_content' ) ) {
		wp_add_privacy_policy_content( 'The Reading Room stats', wp_kses_post( '<p>This site counts visits and feed readers to see how many people read it. A visit is counted without cookies: the visitor\'s IP address and browser name are mixed with a secret that changes every day into a one-way code, so each visitor is counted once a day. The IP address itself is never stored, and the codes are deleted the next day. Feed readers are counted from the name and subscriber count they send when they check the feed.</p>' ) );
	}
} );
