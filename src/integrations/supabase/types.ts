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
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          onlyfans_account_id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          onlyfans_account_id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          onlyfans_account_id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      ad_spend: {
        Row: {
          account_id: string | null
          amount: number
          campaign_id: string
          created_at: string
          date: string
          id: string
          media_buyer: string | null
          notes: string | null
          traffic_source: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          campaign_id: string
          created_at?: string
          date: string
          id?: string
          media_buyer?: string | null
          notes?: string | null
          traffic_source: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          campaign_id?: string
          created_at?: string
          date?: string
          id?: string
          media_buyer?: string | null
          notes?: string | null
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
        ]
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
      sync_logs: {
        Row: {
          account_id: string | null
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
        }
        Insert: {
          account_id?: string | null
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
        }
        Update: {
          account_id?: string | null
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
      tracking_links: {
        Row: {
          account_id: string
          calculated_at: string | null
          campaign_id: string
          campaign_name: string | null
          clicks: number
          conversion_rate: number
          country: string | null
          created_at: string
          external_tracking_link_id: string | null
          id: string
          revenue: number
          revenue_per_click: number
          revenue_per_subscriber: number
          source: string | null
          spenders: number
          subscribers: number
          updated_at: string
          url: string
        }
        Insert: {
          account_id: string
          calculated_at?: string | null
          campaign_id: string
          campaign_name?: string | null
          clicks?: number
          conversion_rate?: number
          country?: string | null
          created_at?: string
          external_tracking_link_id?: string | null
          id?: string
          revenue?: number
          revenue_per_click?: number
          revenue_per_subscriber?: number
          source?: string | null
          spenders?: number
          subscribers?: number
          updated_at?: string
          url: string
        }
        Update: {
          account_id?: string
          calculated_at?: string | null
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          conversion_rate?: number
          country?: string | null
          created_at?: string
          external_tracking_link_id?: string | null
          id?: string
          revenue?: number
          revenue_per_click?: number
          revenue_per_subscriber?: number
          source?: string | null
          spenders?: number
          subscribers?: number
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
        ]
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
      [_ in never]: never
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
