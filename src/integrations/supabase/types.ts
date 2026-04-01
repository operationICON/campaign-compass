export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          avatar_thumb_url: string | null
          avatar_url: string | null
          created_at: string
          display_name: string
          header_url: string | null
          id: string
          is_active: boolean
          last_seen: string | null
          last_synced_at: string | null
          ltv_last_30d: number | null
          ltv_last_7d: number | null
          ltv_last_day: number | null
          ltv_messages: number | null
          ltv_posts: number | null
          ltv_subscriptions: number | null
          ltv_tips: number | null
          ltv_total: number | null
          ltv_updated_at: string | null
          onlyfans_account_id: string
          performer_top: number | null
          subscribe_price: number | null
          subscribers_count: number | null
          sync_enabled: boolean | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_thumb_url?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name: string
          header_url?: string | null
          id?: string
          is_active?: boolean
          last_seen?: string | null
          last_synced_at?: string | null
          ltv_last_30d?: number | null
          ltv_last_7d?: number | null
          ltv_last_day?: number | null
          ltv_messages?: number | null
          ltv_posts?: number | null
          ltv_subscriptions?: number | null
          ltv_tips?: number | null
          ltv_total?: number | null
          ltv_updated_at?: string | null
          onlyfans_account_id: string
          performer_top?: number | null
          subscribe_price?: number | null
          subscribers_count?: number | null
          sync_enabled?: boolean | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_thumb_url?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          header_url?: string | null
          id?: string
          is_active?: boolean
          last_seen?: string | null
          last_synced_at?: string | null
          ltv_last_30d?: number | null
          ltv_last_7d?: number | null
          ltv_last_day?: number | null
          ltv_messages?: number | null
          ltv_posts?: number | null
          ltv_subscriptions?: number | null
          ltv_tips?: number | null
          ltv_total?: number | null
          ltv_updated_at?: string | null
          onlyfans_account_id?: string
          performer_top?: number | null
          subscribe_price?: number | null
          subscribers_count?: number | null
          sync_enabled?: boolean | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      ad_spend: {
        Row: {
          account_id: string | null
          airtable_record_id: string | null
          amount: number
          campaign_id: string
          created_at: string
          date: string
          id: string
          media_buyer: string | null
          notes: string | null
          source_tag: string | null
          spend_type: string | null
          sync_source: string
          tracking_link_id: string | null
          traffic_source: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          airtable_record_id?: string | null
          amount?: number
          campaign_id: string
          created_at?: string
          date: string
          id?: string
          media_buyer?: string | null
          notes?: string | null
          source_tag?: string | null
          spend_type?: string | null
          sync_source?: string
          tracking_link_id?: string | null
          traffic_source: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          airtable_record_id?: string | null
          amount?: number
          campaign_id?: string
          created_at?: string
          date?: string
          id?: string
          media_buyer?: string | null
          notes?: string | null
          source_tag?: string | null
          spend_type?: string | null
          sync_source?: string
          tracking_link_id?: string | null
          traffic_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_spend_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "ad_spend_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_spend_tracking_link_id_fkey"
            columns: ["tracking_link_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          account_id: string | null
          account_name: string | null
          campaign_name: string | null
          created_at: string
          id: string
          message: string | null
          resolved: boolean
          resolved_at: string | null
          tracking_link_id: string | null
          triggered_at: string
          type: string
        }
        Insert: {
          account_id?: string | null
          account_name?: string | null
          campaign_name?: string | null
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          resolved_at?: string | null
          tracking_link_id?: string | null
          triggered_at?: string
          type?: string
        }
        Update: {
          account_id?: string | null
          account_name?: string | null
          campaign_name?: string | null
          created_at?: string
          id?: string
          message?: string | null
          resolved?: boolean
          resolved_at?: string | null
          tracking_link_id?: string | null
          triggered_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_tracking_link_id_fkey"
            columns: ["tracking_link_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_logs: {
        Row: {
          created: number | null
          created_at: string | null
          deleted: number | null
          error_details: Json | null
          errors: number | null
          id: string
          imported_by: string | null
          matched: number | null
          total_rows: number | null
        }
        Insert: {
          created?: number | null
          created_at?: string | null
          deleted?: number | null
          error_details?: Json | null
          errors?: number | null
          id?: string
          imported_by?: string | null
          matched?: number | null
          total_rows?: number | null
        }
        Update: {
          created?: number | null
          created_at?: string | null
          deleted?: number | null
          error_details?: Json | null
          errors?: number | null
          id?: string
          imported_by?: string | null
          matched?: number | null
          total_rows?: number | null
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          account_id: string
          country: string | null
          created_at: string
          id: string
          name: string
          status: string
          traffic_source: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          country?: string | null
          created_at?: string
          id?: string
          name: string
          status?: string
          traffic_source?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          status?: string
          traffic_source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          account_id: string | null
          clicks: number
          conversion_rate: number | null
          created_at: string
          date: string
          epc: number | null
          id: string
          new_revenue: number
          new_subscribers: number
          revenue: number
          spenders: number
          subscribers: number
          tracking_link_id: string
        }
        Insert: {
          account_id?: string | null
          clicks?: number
          conversion_rate?: number | null
          created_at?: string
          date: string
          epc?: number | null
          id?: string
          new_revenue?: number
          new_subscribers?: number
          revenue?: number
          spenders?: number
          subscribers?: number
          tracking_link_id: string
        }
        Update: {
          account_id?: string | null
          clicks?: number
          conversion_rate?: number | null
          created_at?: string
          date?: string
          epc?: number | null
          id?: string
          new_revenue?: number
          new_subscribers?: number
          revenue?: number
          spenders?: number
          subscribers?: number
          tracking_link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_metrics_tracking_link_id_fkey"
            columns: ["tracking_link_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      fan_attributions: {
        Row: {
          account_id: string | null
          created_at: string | null
          fan_id: string
          fan_username: string | null
          id: string
          is_active: boolean | null
          is_expired: boolean | null
          source: string | null
          subscribe_date_approx: string | null
          subscribed_on_duration: string | null
          tracking_link_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          fan_id: string
          fan_username?: string | null
          id?: string
          is_active?: boolean | null
          is_expired?: boolean | null
          source?: string | null
          subscribe_date_approx?: string | null
          subscribed_on_duration?: string | null
          tracking_link_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          fan_id?: string
          fan_username?: string | null
          id?: string
          is_active?: boolean | null
          is_expired?: boolean | null
          source?: string | null
          subscribe_date_approx?: string | null
          subscribed_on_duration?: string | null
          tracking_link_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fan_attributions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fan_attributions_tracking_link_id_fkey"
            columns: ["tracking_link_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      fan_link_subs: {
        Row: {
          account_id: string
          entry_timestamp: string | null
          fan_id: string
          id: string
          link_id: string
          revenue: number | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          entry_timestamp?: string | null
          fan_id: string
          id?: string
          link_id: string
          revenue?: number | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          entry_timestamp?: string | null
          fan_id?: string
          id?: string
          link_id?: string
          revenue?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fan_link_subs_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      fan_ltv: {
        Row: {
          fan_id: string
          first_seen_date: string | null
          first_seen_model: string | null
          first_seen_tracking_link: string | null
          id: string
          is_cross_pollinated: boolean | null
          models_spent_on: string[] | null
          total_ltv_all_models: number | null
          updated_at: string | null
        }
        Insert: {
          fan_id: string
          first_seen_date?: string | null
          first_seen_model?: string | null
          first_seen_tracking_link?: string | null
          id?: string
          is_cross_pollinated?: boolean | null
          models_spent_on?: string[] | null
          total_ltv_all_models?: number | null
          updated_at?: string | null
        }
        Update: {
          fan_id?: string
          first_seen_date?: string | null
          first_seen_model?: string | null
          first_seen_tracking_link?: string | null
          id?: string
          is_cross_pollinated?: boolean | null
          models_spent_on?: string[] | null
          total_ltv_all_models?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fan_spend: {
        Row: {
          account_id: string | null
          calculated_at: string | null
          created_at: string | null
          fan_id: string
          id: string
          revenue: number | null
          source: string | null
          tracking_link_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          calculated_at?: string | null
          created_at?: string | null
          fan_id: string
          id?: string
          revenue?: number | null
          source?: string | null
          tracking_link_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          calculated_at?: string | null
          created_at?: string | null
          fan_id?: string
          id?: string
          revenue?: number | null
          source?: string | null
          tracking_link_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fan_spend_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fan_spend_tracking_link_id_fkey"
            columns: ["tracking_link_id"]
            isOneToOne: false
            referencedRelation: "tracking_links"
            referencedColumns: ["id"]
          },
        ]
      }
      fan_spenders: {
        Row: {
          account_id: string
          fan_id: string
          id: string
          revenue_total: number | null
          tracking_link_id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          fan_id: string
          id?: string
          revenue_total?: number | null
          tracking_link_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          fan_id?: string
          id?: string
          revenue_total?: number | null
          tracking_link_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      fan_subscriptions: {
        Row: {
          account_id: string
          created_at: string | null
          fan_id: string
          id: string
          is_active: boolean | null
          is_new_sub: boolean | null
          subscribed_on: string | null
          tracking_link_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          fan_id: string
          id?: string
          is_active?: boolean | null
          is_new_sub?: boolean | null
          subscribed_on?: string | null
          tracking_link_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          fan_id?: string
          id?: string
          is_active?: boolean | null
          is_new_sub?: boolean | null
          subscribed_on?: string | null
          tracking_link_id?: string
        }
        Relationships: []
      }
      fans: {
        Row: {
          created_at: string | null
          fan_id: string
          first_subscribe_account: string | null
          first_subscribe_date: string | null
          first_subscribe_link_id: string | null
          id: string
          is_new_fan: boolean | null
          join_date: string | null
          sub_history_checked_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          fan_id: string
          first_subscribe_account?: string | null
          first_subscribe_date?: string | null
          first_subscribe_link_id?: string | null
          id?: string
          is_new_fan?: boolean | null
          join_date?: string | null
          sub_history_checked_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          fan_id?: string
          first_subscribe_account?: string | null
          first_subscribe_date?: string | null
          first_subscribe_link_id?: string | null
          id?: string
          is_new_fan?: boolean | null
          join_date?: string | null
          sub_history_checked_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      manual_notes: {
        Row: {
          account_id: string | null
          campaign_id: string | null
          campaign_name: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_notes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "manual_notes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          type?: string
        }
        Relationships: []
      }
      source_tag_rules: {
        Row: {
          color: string
          created_at: string
          id: string
          keywords: string[]
          priority: number
          tag_name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          keywords?: string[]
          priority?: number
          tag_name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          keywords?: string[]
          priority?: number
          tag_name?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          account_id: string | null
          accounts_synced: number | null
          completed_at: string | null
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          message: string | null
          records_processed: number
          started_at: string
          status: string
          success: boolean | null
          tracking_links_synced: number | null
          triggered_by: string | null
        }
        Insert: {
          account_id?: string | null
          accounts_synced?: number | null
          completed_at?: string | null
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          message?: string | null
          records_processed?: number
          started_at?: string
          status?: string
          success?: boolean | null
          tracking_links_synced?: number | null
          triggered_by?: string | null
        }
        Update: {
          account_id?: string | null
          accounts_synced?: number | null
          completed_at?: string | null
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          message?: string | null
          records_processed?: number
          started_at?: string
          status?: string
          success?: boolean | null
          tracking_links_synced?: number | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      test_logs: {
        Row: {
          account_username: string | null
          created_at: string
          id: string
          message: string | null
          response_time_ms: number | null
          run_at: string
          status: string
          test_name: string
        }
        Insert: {
          account_username?: string | null
          created_at?: string
          id?: string
          message?: string | null
          response_time_ms?: number | null
          run_at?: string
          status?: string
          test_name: string
        }
        Update: {
          account_username?: string | null
          created_at?: string
          id?: string
          message?: string | null
          response_time_ms?: number | null
          run_at?: string
          status?: string
          test_name?: string
        }
        Relationships: []
      }
      tracking_link_ltv: {
        Row: {
          account_id: string
          cross_poll_avg_per_fan: number | null
          cross_poll_conversion_pct: number | null
          cross_poll_fans: number | null
          cross_poll_revenue: number | null
          external_tracking_link_id: string
          id: string
          is_estimated: boolean | null
          ltv_last_30d: number | null
          ltv_last_7d: number | null
          ltv_per_sub: number | null
          new_subs_last_30d: number | null
          new_subs_last_7d: number | null
          new_subs_total: number | null
          spender_pct: number | null
          spenders_count: number | null
          total_ltv: number | null
          tracking_link_id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          cross_poll_avg_per_fan?: number | null
          cross_poll_conversion_pct?: number | null
          cross_poll_fans?: number | null
          cross_poll_revenue?: number | null
          external_tracking_link_id: string
          id?: string
          is_estimated?: boolean | null
          ltv_last_30d?: number | null
          ltv_last_7d?: number | null
          ltv_per_sub?: number | null
          new_subs_last_30d?: number | null
          new_subs_last_7d?: number | null
          new_subs_total?: number | null
          spender_pct?: number | null
          spenders_count?: number | null
          total_ltv?: number | null
          tracking_link_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          cross_poll_avg_per_fan?: number | null
          cross_poll_conversion_pct?: number | null
          cross_poll_fans?: number | null
          cross_poll_revenue?: number | null
          external_tracking_link_id?: string
          id?: string
          is_estimated?: boolean | null
          ltv_last_30d?: number | null
          ltv_last_7d?: number | null
          ltv_per_sub?: number | null
          new_subs_last_30d?: number | null
          new_subs_last_7d?: number | null
          new_subs_total?: number | null
          spender_pct?: number | null
          spenders_count?: number | null
          total_ltv?: number | null
          tracking_link_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      tracking_links: {
        Row: {
          account_id: string
          arpu: number | null
          calculated_at: string | null
          campaign_id: string
          campaign_name: string | null
          clicks: number
          conversion_rate: number
          cost_per_click: number | null
          cost_per_lead: number | null
          cost_total: number | null
          cost_type: string | null
          cost_value: number | null
          country: string | null
          cpc_real: number | null
          cpl_real: number | null
          created_at: string
          cvr: number | null
          deleted_at: string | null
          external_tracking_link_id: string | null
          fans_last_synced_at: string | null
          id: string
          ltv: number | null
          ltv_per_sub: number | null
          manually_tagged: boolean
          media_buyer: string | null
          needs_full_sync: boolean | null
          needs_spend: boolean | null
          onlytraffic_marketer: string | null
          onlytraffic_order_id: string | null
          onlytraffic_order_type: string | null
          onlytraffic_status: string | null
          payment_type: string | null
          profit: number | null
          revenue: number
          revenue_per_click: number
          revenue_per_subscriber: number
          review_flag: boolean | null
          roi: number | null
          source: string | null
          source_tag: string | null
          spender_rate: number | null
          spenders: number
          spenders_count: number | null
          status: string | null
          subscribers: number
          traffic_category: string | null
          traffic_source_id: string | null
          updated_at: string
          url: string
        }
        Insert: {
          account_id: string
          arpu?: number | null
          calculated_at?: string | null
          campaign_id: string
          campaign_name?: string | null
          clicks?: number
          conversion_rate?: number
          cost_per_click?: number | null
          cost_per_lead?: number | null
          cost_total?: number | null
          cost_type?: string | null
          cost_value?: number | null
          country?: string | null
          cpc_real?: number | null
          cpl_real?: number | null
          created_at?: string
          cvr?: number | null
          deleted_at?: string | null
          external_tracking_link_id?: string | null
          fans_last_synced_at?: string | null
          id?: string
          ltv?: number | null
          ltv_per_sub?: number | null
          manually_tagged?: boolean
          media_buyer?: string | null
          needs_full_sync?: boolean | null
          needs_spend?: boolean | null
          onlytraffic_marketer?: string | null
          onlytraffic_order_id?: string | null
          onlytraffic_order_type?: string | null
          onlytraffic_status?: string | null
          payment_type?: string | null
          profit?: number | null
          revenue?: number
          revenue_per_click?: number
          revenue_per_subscriber?: number
          review_flag?: boolean | null
          roi?: number | null
          source?: string | null
          source_tag?: string | null
          spender_rate?: number | null
          spenders?: number
          spenders_count?: number | null
          status?: string | null
          subscribers?: number
          traffic_category?: string | null
          traffic_source_id?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          account_id?: string
          arpu?: number | null
          calculated_at?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          conversion_rate?: number
          cost_per_click?: number | null
          cost_per_lead?: number | null
          cost_total?: number | null
          cost_type?: string | null
          cost_value?: number | null
          country?: string | null
          cpc_real?: number | null
          cpl_real?: number | null
          created_at?: string
          cvr?: number | null
          deleted_at?: string | null
          external_tracking_link_id?: string | null
          fans_last_synced_at?: string | null
          id?: string
          ltv?: number | null
          ltv_per_sub?: number | null
          manually_tagged?: boolean
          media_buyer?: string | null
          needs_full_sync?: boolean | null
          needs_spend?: boolean | null
          onlytraffic_marketer?: string | null
          onlytraffic_order_id?: string | null
          onlytraffic_order_type?: string | null
          onlytraffic_status?: string | null
          payment_type?: string | null
          profit?: number | null
          revenue?: number
          revenue_per_click?: number
          revenue_per_subscriber?: number
          review_flag?: boolean | null
          roi?: number | null
          source?: string | null
          source_tag?: string | null
          spender_rate?: number | null
          spenders?: number
          spenders_count?: number | null
          status?: string | null
          subscribers?: number
          traffic_category?: string | null
          traffic_source_id?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_performance"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "tracking_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracking_links_traffic_source_id_fkey"
            columns: ["traffic_source_id"]
            isOneToOne: false
            referencedRelation: "traffic_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      traffic_sources: {
        Row: {
          campaign_count: number
          category: string
          color: string
          created_at: string
          id: string
          is_archived: boolean
          keywords: string[]
          name: string
          updated_at: string
        }
        Insert: {
          campaign_count?: number
          category?: string
          color?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          keywords?: string[]
          name: string
          updated_at?: string
        }
        Update: {
          campaign_count?: number
          category?: string
          color?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          keywords?: string[]
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string | null
          created_at: string
          currency: string | null
          date: string | null
          external_transaction_id: string | null
          fan_id: string | null
          fan_username: string | null
          fee: number | null
          id: string
          revenue: number
          revenue_net: number | null
          status: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          currency?: string | null
          date?: string | null
          external_transaction_id?: string | null
          fan_id?: string | null
          fan_username?: string | null
          fee?: number | null
          id?: string
          revenue?: number
          revenue_net?: number | null
          status?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          currency?: string | null
          date?: string | null
          external_transaction_id?: string | null
          fan_id?: string | null
          fan_username?: string | null
          fee?: number | null
          id?: string
          revenue?: number
          revenue_net?: number | null
          status?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      campaign_performance: {
        Row: {
          account_id: string | null
          account_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          conversion_rate: number | null
          country: string | null
          epc: number | null
          profit: number | null
          revenue_per_subscriber: number | null
          roi: number | null
          total_ad_spend: number | null
          total_clicks: number | null
          total_revenue: number | null
          total_spenders: number | null
          total_subscribers: number | null
          traffic_source: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_ltv_by_period: {
        Args: { p_account_id?: string; p_period: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
