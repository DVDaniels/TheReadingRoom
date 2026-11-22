<?php
// Deleting the plugin removes everything it kept: the counts table and its settings.
defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

global $wpdb;
$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $wpdb->prefix . 'reading_room_stats' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange -- removing the plugin's own table.
foreach ( array( 'trr_stats_db_version', 'trr_stats_since', 'trr_stats_salt', 'trr_stats_settings' ) as $trr_stats_option ) {
	delete_option( $trr_stats_option );
}
delete_transient( 'trr_stats_search' );
wp_clear_scheduled_hook( 'trr_stats_daily' );
