<?php
// Deleting the plugin removes everything it kept: the counts table and its settings.
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;
$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'reading_room_stats' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
foreach ( array( 'rrs_db_version', 'rrs_since', 'rrs_salt', 'rrs_settings' ) as $o ) {
	delete_option( $o );
}
delete_transient( 'rrs_search' );
wp_clear_scheduled_hook( 'rrs_daily' );
