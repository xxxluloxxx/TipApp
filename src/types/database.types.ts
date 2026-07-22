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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      account_transfers: {
        Row: {
          amount: number
          commission_amount: number
          created_at: string
          description: string | null
          expense_id: string | null
          from_account_id: string
          id: string
          to_account_id: string
          transfer_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          commission_amount?: number
          created_at?: string
          description?: string | null
          expense_id?: string | null
          from_account_id: string
          id?: string
          to_account_id: string
          transfer_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          commission_amount?: number
          created_at?: string
          description?: string | null
          expense_id?: string | null
          from_account_id?: string
          id?: string
          to_account_id?: string
          transfer_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_transfers_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "account_transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "account_transfers_to_account_id_fkey"
            columns: ["to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          initial_balance: number
          name: string
          sort_order: number
          transfer_commission: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          initial_balance?: number
          name: string
          sort_order?: number
          transfer_commission?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          initial_balance?: number
          name?: string
          sort_order?: number
          transfer_commission?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bet_slip_legs: {
        Row: {
          bet_slip_match_id: string
          created_at: string
          id: string
          market_label: string
          market_type: string
          odds: number | null
          raw_text: string | null
          selection_label: string
          selector: string | null
          status: string
          threshold: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bet_slip_match_id: string
          created_at?: string
          id?: string
          market_label: string
          market_type: string
          odds?: number | null
          raw_text?: string | null
          selection_label: string
          selector?: string | null
          status?: string
          threshold?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bet_slip_match_id?: string
          created_at?: string
          id?: string
          market_label?: string
          market_type?: string
          odds?: number | null
          raw_text?: string | null
          selection_label?: string
          selector?: string | null
          status?: string
          threshold?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_slip_legs_bet_slip_match_id_fkey"
            columns: ["bet_slip_match_id"]
            isOneToOne: false
            referencedRelation: "bet_slip_match_status"
            referencedColumns: ["bet_slip_match_id"]
          },
          {
            foreignKeyName: "bet_slip_legs_bet_slip_match_id_fkey"
            columns: ["bet_slip_match_id"]
            isOneToOne: false
            referencedRelation: "bet_slip_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_slip_matches: {
        Row: {
          bet_slip_id: string
          created_at: string
          id: string
          live_match_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bet_slip_id: string
          created_at?: string
          id?: string
          live_match_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bet_slip_id?: string
          created_at?: string
          id?: string
          live_match_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_slip_matches_bet_slip_id_fkey"
            columns: ["bet_slip_id"]
            isOneToOne: false
            referencedRelation: "bet_slip_summary"
            referencedColumns: ["bet_slip_id"]
          },
          {
            foreignKeyName: "bet_slip_matches_bet_slip_id_fkey"
            columns: ["bet_slip_id"]
            isOneToOne: false
            referencedRelation: "bet_slips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_slip_matches_live_match_id_fkey"
            columns: ["live_match_id"]
            isOneToOne: false
            referencedRelation: "live_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_slips: {
        Row: {
          created_at: string
          id: string
          reference: string | null
          stake_amount: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reference?: string | null
          stake_amount?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reference?: string | null
          stake_amount?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          amount_limit: number
          category_id: string
          created_at: string
          id: string
          month_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_limit: number
          category_id: string
          created_at?: string
          id?: string
          month_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_limit?: number
          category_id?: string
          created_at?: string
          id?: string
          month_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      card_expenses: {
        Row: {
          amount: number
          card_id: string
          created_at: string
          description: string | null
          expense_date: string
          id: string
          installment_number: number | null
          installment_total: number | null
          notes: string | null
          person_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          card_id: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          notes?: string | null
          person_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          card_id?: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          installment_number?: number | null
          installment_total?: number | null
          notes?: string | null
          person_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_expenses_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "credit_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_expenses_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "card_people"
            referencedColumns: ["id"]
          },
        ]
      }
      card_people: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          user_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      credit_cards: {
        Row: {
          color: string | null
          created_at: string
          id: string
          last_four_digits: string | null
          name: string
          payment_due_day: number | null
          statement_cutoff_day: number | null
          suggested_monthly_limit: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          last_four_digits?: string | null
          name: string
          payment_due_day?: number | null
          statement_cutoff_day?: number | null
          suggested_monthly_limit?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          last_four_digits?: string | null
          name?: string
          payment_due_day?: number | null
          statement_cutoff_day?: number | null
          suggested_monthly_limit?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      debt_movements: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string
          debt_id: string
          description: string | null
          id: string
          movement_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          created_at?: string
          debt_id: string
          description?: string | null
          id?: string
          movement_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string
          debt_id?: string
          description?: string | null
          id?: string
          movement_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debt_movements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "debt_movements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debt_movements_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debt_balances"
            referencedColumns: ["debt_id"]
          },
          {
            foreignKeyName: "debt_movements_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
        ]
      }
      debt_people: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      debts: {
        Row: {
          created_at: string
          description: string | null
          direction: string
          id: string
          person_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          direction: string
          id?: string
          person_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          direction?: string
          id?: string
          person_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "debt_people"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          account_id: string
          amount: number
          category_id: string
          created_at: string
          description: string | null
          expense_date: string
          expense_time: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category_id: string
          created_at?: string
          description?: string | null
          expense_date?: string
          expense_time?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          category_id?: string
          created_at?: string
          description?: string | null
          expense_date?: string
          expense_time?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_expense_instances: {
        Row: {
          created_at: string
          expense_id: string | null
          fixed_expense_id: string
          id: string
          paid_at: string | null
          period: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expense_id?: string | null
          fixed_expense_id: string
          id?: string
          paid_at?: string | null
          period: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expense_id?: string | null
          fixed_expense_id?: string
          id?: string
          paid_at?: string | null
          period?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_expense_instances_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_expense_instances_fixed_expense_id_fkey"
            columns: ["fixed_expense_id"]
            isOneToOne: false
            referencedRelation: "fixed_expense_instances_current"
            referencedColumns: ["fixed_expense_id"]
          },
          {
            foreignKeyName: "fixed_expense_instances_fixed_expense_id_fkey"
            columns: ["fixed_expense_id"]
            isOneToOne: false
            referencedRelation: "fixed_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_expenses: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          frequency: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_day: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          frequency?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_day: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          frequency?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_day?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      incomes: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          description: string | null
          id: string
          income_date: string
          income_time: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          income_date?: string
          income_time?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          income_date?: string
          income_time?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incomes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "incomes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      live_matches: {
        Row: {
          away_team: string | null
          clear_chances_away: number | null
          clear_chances_home: number | null
          competition: string | null
          corners_away: number | null
          corners_home: number | null
          created_at: string
          etag_dc: string | null
          etag_df_st: string | null
          etag_df_su: string | null
          first_half_score_away: number | null
          first_half_score_home: number | null
          flashscore_mid: string
          flashscore_url: string
          home_team: string | null
          id: string
          incidents: Json
          last_changed_at: string
          last_poll_error: string | null
          last_poll_ok: boolean
          last_polled_at: string | null
          next_poll_at: string
          poll_interval_seconds: number
          red_cards_away: number | null
          red_cards_home: number | null
          scheduled_kickoff_ts: string | null
          score_away: number | null
          score_home: number | null
          shots_on_target_away: number | null
          shots_on_target_home: number | null
          stage_anchor_ts: string | null
          stage_code: number | null
          state: string
          updated_at: string
          user_id: string
          yellow_cards_away: number | null
          yellow_cards_home: number | null
        }
        Insert: {
          away_team?: string | null
          clear_chances_away?: number | null
          clear_chances_home?: number | null
          competition?: string | null
          corners_away?: number | null
          corners_home?: number | null
          created_at?: string
          etag_dc?: string | null
          etag_df_st?: string | null
          etag_df_su?: string | null
          first_half_score_away?: number | null
          first_half_score_home?: number | null
          flashscore_mid: string
          flashscore_url: string
          home_team?: string | null
          id?: string
          incidents?: Json
          last_changed_at?: string
          last_poll_error?: string | null
          last_poll_ok?: boolean
          last_polled_at?: string | null
          next_poll_at?: string
          poll_interval_seconds?: number
          red_cards_away?: number | null
          red_cards_home?: number | null
          scheduled_kickoff_ts?: string | null
          score_away?: number | null
          score_home?: number | null
          shots_on_target_away?: number | null
          shots_on_target_home?: number | null
          stage_anchor_ts?: string | null
          stage_code?: number | null
          state?: string
          updated_at?: string
          user_id: string
          yellow_cards_away?: number | null
          yellow_cards_home?: number | null
        }
        Update: {
          away_team?: string | null
          clear_chances_away?: number | null
          clear_chances_home?: number | null
          competition?: string | null
          corners_away?: number | null
          corners_home?: number | null
          created_at?: string
          etag_dc?: string | null
          etag_df_st?: string | null
          etag_df_su?: string | null
          first_half_score_away?: number | null
          first_half_score_home?: number | null
          flashscore_mid?: string
          flashscore_url?: string
          home_team?: string | null
          id?: string
          incidents?: Json
          last_changed_at?: string
          last_poll_error?: string | null
          last_poll_ok?: boolean
          last_polled_at?: string | null
          next_poll_at?: string
          poll_interval_seconds?: number
          red_cards_away?: number | null
          red_cards_home?: number | null
          scheduled_kickoff_ts?: string | null
          score_away?: number | null
          score_home?: number | null
          shots_on_target_away?: number | null
          shots_on_target_home?: number | null
          stage_anchor_ts?: string | null
          stage_code?: number | null
          state?: string
          updated_at?: string
          user_id?: string
          yellow_cards_away?: number | null
          yellow_cards_home?: number | null
        }
        Relationships: []
      }
      loan_debtor_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          loan_debtor_id: string
          payment_date: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          loan_debtor_id: string
          payment_date?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          loan_debtor_id?: string
          payment_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_debtor_payments_loan_debtor_id_fkey"
            columns: ["loan_debtor_id"]
            isOneToOne: false
            referencedRelation: "loan_debtor_balances"
            referencedColumns: ["loan_debtor_id"]
          },
          {
            foreignKeyName: "loan_debtor_payments_loan_debtor_id_fkey"
            columns: ["loan_debtor_id"]
            isOneToOne: false
            referencedRelation: "loan_debtors"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_debtors: {
        Row: {
          amount_owed: number
          created_at: string
          debt_person_id: string
          id: string
          loan_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_owed: number
          created_at?: string
          debt_person_id: string
          id?: string
          loan_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_owed?: number
          created_at?: string
          debt_person_id?: string
          id?: string
          loan_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_debtors_debt_person_id_fkey"
            columns: ["debt_person_id"]
            isOneToOne: false
            referencedRelation: "debt_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_debtors_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loan_progress"
            referencedColumns: ["loan_id"]
          },
          {
            foreignKeyName: "loan_debtors_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          loan_id: string
          paid_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          loan_id: string
          paid_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          loan_id?: string
          paid_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_installments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loan_progress"
            referencedColumns: ["loan_id"]
          },
          {
            foreignKeyName: "loan_installments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          created_at: string
          description: string | null
          id: string
          monthly_installment_amount: number
          name: string
          start_date: string
          term_months: number
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          monthly_installment_amount: number
          name: string
          start_date: string
          term_months: number
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          monthly_installment_amount?: number
          name?: string
          start_date?: string
          term_months?: number
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          accent_color: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          theme_preference: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          theme_preference?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          theme_preference?: string
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      account_balances: {
        Row: {
          account_id: string | null
          balance: number | null
          name: string | null
          user_id: string | null
        }
        Relationships: []
      }
      bet_slip_match_status: {
        Row: {
          bet_slip_id: string | null
          bet_slip_match_id: string | null
          leg_count: number | null
          live_match_id: string | null
          lost_legs: number | null
          not_monitorable_legs: number | null
          pending_legs: number | null
          status: string | null
          user_id: string | null
          won_legs: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bet_slip_matches_bet_slip_id_fkey"
            columns: ["bet_slip_id"]
            isOneToOne: false
            referencedRelation: "bet_slip_summary"
            referencedColumns: ["bet_slip_id"]
          },
          {
            foreignKeyName: "bet_slip_matches_bet_slip_id_fkey"
            columns: ["bet_slip_id"]
            isOneToOne: false
            referencedRelation: "bet_slips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_slip_matches_live_match_id_fkey"
            columns: ["live_match_id"]
            isOneToOne: false
            referencedRelation: "live_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_slip_summary: {
        Row: {
          bet_slip_id: string | null
          leg_count: number | null
          legs_missing_odds: number | null
          live_matches_count: number | null
          lost_matches: number | null
          match_count: number | null
          pending_matches: number | null
          potential_winnings: number | null
          reference: string | null
          stake_amount: number | null
          status: string | null
          total_odds: number | null
          user_id: string | null
          won_matches: number | null
        }
        Relationships: []
      }
      debt_balances: {
        Row: {
          balance: number | null
          debt_id: string | null
          direction: string | null
          user_id: string | null
        }
        Relationships: []
      }
      fixed_expense_instances_current: {
        Row: {
          category_color: string | null
          category_icon: string | null
          category_id: string | null
          category_name: string | null
          expense_id: string | null
          fixed_expense_id: string | null
          fixed_expense_name: string | null
          fixed_expense_notes: string | null
          instance_id: string | null
          paid_account_id: string | null
          paid_amount: number | null
          paid_at: string | null
          paid_expense_date: string | null
          payment_day: number | null
          period: string | null
          status: string | null
          template_amount: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["paid_account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "expenses_account_id_fkey"
            columns: ["paid_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_expense_instances_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_expenses_summary: {
        Row: {
          current_period: string | null
          omitted_count: number | null
          paid_amount: number | null
          paid_count: number | null
          planned_count: number | null
          total_amount: number | null
          trailing_avg_monthly: number | null
          user_id: string | null
        }
        Relationships: []
      }
      loan_debtor_balances: {
        Row: {
          amount_owed: number | null
          amount_received: number | null
          balance_remaining: number | null
          debt_person_id: string | null
          last_payment_amount: number | null
          last_payment_date: string | null
          loan_debtor_id: string | null
          loan_id: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_debtors_debt_person_id_fkey"
            columns: ["debt_person_id"]
            isOneToOne: false
            referencedRelation: "debt_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_debtors_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loan_progress"
            referencedColumns: ["loan_id"]
          },
          {
            foreignKeyName: "loan_debtors_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_progress: {
        Row: {
          description: string | null
          estimated_end_date: string | null
          has_overdue: boolean | null
          is_completed: boolean | null
          loan_id: string | null
          monthly_installment_amount: number | null
          name: string | null
          next_installment_amount: number | null
          next_installment_due_date: string | null
          next_installment_number: number | null
          paid_amount: number | null
          paid_count: number | null
          remaining_amount: number | null
          start_date: string | null
          term_months: number | null
          total_amount: number | null
          total_count: number | null
          user_id: string | null
        }
        Relationships: []
      }
      loans_summary: {
        Row: {
          active_loans_count: number | null
          has_any_overdue: boolean | null
          loans_count: number | null
          total_borrowed: number | null
          total_paid: number | null
          total_pending: number | null
          total_receivable: number | null
          total_receivable_remaining: number | null
          total_received: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _account_transfer_delete: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      _account_transfer_insert: {
        Args: {
          p_amount: number
          p_commission_amount: number
          p_description: string
          p_from_account_id: string
          p_to_account_id: string
          p_transfer_date: string
        }
        Returns: string
      }
      category_is_accessible: {
        Args: { p_category_id: string; p_user_id: string }
        Returns: boolean
      }
      create_account_transfer: {
        Args: {
          p_amount: number
          p_commission_amount: number
          p_description?: string
          p_from_account_id: string
          p_to_account_id: string
          p_transfer_date?: string
        }
        Returns: string
      }
      create_bet_slip: {
        Args: { p_groups?: Json; p_reference?: string; p_stake_amount?: number }
        Returns: string
      }
      create_debt: {
        Args: {
          p_account_id?: string
          p_amount: number
          p_description?: string
          p_direction: string
          p_movement_date?: string
          p_person_id: string
        }
        Returns: string
      }
      create_live_match: {
        Args: {
          p_away_team?: string
          p_clear_chances_away?: number
          p_clear_chances_home?: number
          p_competition?: string
          p_corners_away?: number
          p_corners_home?: number
          p_first_half_score_away?: number
          p_first_half_score_home?: number
          p_flashscore_mid: string
          p_flashscore_url: string
          p_home_team?: string
          p_incidents?: Json
          p_last_poll_ok?: boolean
          p_poll_interval_seconds?: number
          p_red_cards_away?: number
          p_red_cards_home?: number
          p_scheduled_kickoff_ts?: string
          p_score_away?: number
          p_score_home?: number
          p_shots_on_target_away?: number
          p_shots_on_target_home?: number
          p_stage_anchor_ts?: string
          p_stage_code?: number
          p_yellow_cards_away?: number
          p_yellow_cards_home?: number
        }
        Returns: string
      }
      create_loan: {
        Args: {
          p_description?: string
          p_monthly_installment_amount: number
          p_name: string
          p_start_date: string
          p_term_months: number
          p_total_amount: number
        }
        Returns: string
      }
      delete_account_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      ensure_current_fixed_expense_instances: {
        Args: never
        Returns: undefined
      }
      pay_fixed_expense_instance: {
        Args: {
          p_account_id: string
          p_amount?: number
          p_description?: string
          p_expense_date?: string
          p_instance_id: string
        }
        Returns: string
      }
      update_account_transfer: {
        Args: {
          p_amount: number
          p_commission_amount: number
          p_description: string
          p_from_account_id: string
          p_to_account_id: string
          p_transfer_date: string
          p_transfer_id: string
        }
        Returns: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
