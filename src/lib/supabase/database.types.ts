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
    PostgrestVersion: '14.15'
  }
  public: {
    Tables: {
      agent_decisions: {
        Row: {
          agent_run_id: string
          concise_rationale: string
          confidence: number | null
          context_snapshot_id: string
          created_at: string
          decided_at: string
          decision_type: string
          experiment_id: string
          id: string
          instrument_id: string | null
          owner_id: string
          proposal_status: string
          rejection_reason_code: string | null
          structured_output: Json
        }
        Insert: {
          agent_run_id: string
          concise_rationale: string
          confidence?: number | null
          context_snapshot_id: string
          created_at?: string
          decided_at: string
          decision_type: string
          experiment_id: string
          id?: string
          instrument_id?: string | null
          owner_id: string
          proposal_status: string
          rejection_reason_code?: string | null
          structured_output: Json
        }
        Update: {
          agent_run_id?: string
          concise_rationale?: string
          confidence?: number | null
          context_snapshot_id?: string
          created_at?: string
          decided_at?: string
          decision_type?: string
          experiment_id?: string
          id?: string
          instrument_id?: string | null
          owner_id?: string
          proposal_status?: string
          rejection_reason_code?: string | null
          structured_output?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'agent_decisions_agent_run_id_owner_id_fkey'
            columns: ['agent_run_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_runs'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_decisions_context_snapshot_id_owner_id_fkey'
            columns: ['context_snapshot_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'decision_context_snapshots'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_decisions_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_decisions_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_decisions_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
        ]
      }
      agent_runs: {
        Row: {
          correlation_id: string
          created_at: string
          decision_at: string
          experiment_id: string
          finished_at: string | null
          id: string
          model: string
          owner_id: string
          prompt_version_id: string | null
          role: string
          routing_reason: string
          run_type: string
          scheduler_run_id: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          decision_at: string
          experiment_id: string
          finished_at?: string | null
          id?: string
          model: string
          owner_id: string
          prompt_version_id?: string | null
          role: string
          routing_reason: string
          run_type: string
          scheduler_run_id?: string | null
          started_at?: string | null
          status: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          decision_at?: string
          experiment_id?: string
          finished_at?: string | null
          id?: string
          model?: string
          owner_id?: string
          prompt_version_id?: string | null
          role?: string
          routing_reason?: string
          run_type?: string
          scheduler_run_id?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_runs_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_runs_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_runs_prompt_version_id_owner_id_fkey'
            columns: ['prompt_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'prompt_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'agent_runs_scheduler_run_fk'
            columns: ['scheduler_run_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'scheduler_health_view'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      agent_tool_calls: {
        Row: {
          agent_run_id: string
          created_at: string
          finished_at: string | null
          id: string
          owner_id: string
          request_summary: Json
          response_summary: Json
          sequence_no: number
          started_at: string
          status: string
          tool_name: string
        }
        Insert: {
          agent_run_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          owner_id: string
          request_summary: Json
          response_summary: Json
          sequence_no: number
          started_at: string
          status: string
          tool_name: string
        }
        Update: {
          agent_run_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          owner_id?: string
          request_summary?: Json
          response_summary?: Json
          sequence_no?: number
          started_at?: string
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agent_tool_calls_agent_run_id_owner_id_fkey'
            columns: ['agent_run_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_runs'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      ai_budget_policies: {
        Row: {
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          lifetime_hard_limit: number
          monthly_hard_limit: number
          monthly_soft_limit: number
          owner_id: string
          quota_config: Json
          timezone: string
          trading_day_hard_limit: number
          version: number
        }
        Insert: {
          created_at?: string
          currency?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          lifetime_hard_limit: number
          monthly_hard_limit: number
          monthly_soft_limit: number
          owner_id: string
          quota_config: Json
          timezone?: string
          trading_day_hard_limit: number
          version: number
        }
        Update: {
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          lifetime_hard_limit?: number
          monthly_hard_limit?: number
          monthly_soft_limit?: number
          owner_id?: string
          quota_config?: Json
          timezone?: string
          trading_day_hard_limit?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'ai_budget_policies_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      app_users: {
        Row: {
          bootstrapped_at: string
          created_at: string
          email: string
          is_active: boolean
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bootstrapped_at?: string
          created_at?: string
          email: string
          is_active?: boolean
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bootstrapped_at?: string
          created_at?: string
          email?: string
          is_active?: boolean
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      borrow_availability: {
        Row: {
          available_at: string
          available_quantity: number | null
          created_at: string
          first_seen_at: string
          id: string
          instrument_id: string
          is_available: boolean
          owner_id: string
          provider_event_at: string
          provider_record_key: string
          source_id: string
        }
        Insert: {
          available_at: string
          available_quantity?: number | null
          created_at?: string
          first_seen_at: string
          id?: string
          instrument_id: string
          is_available: boolean
          owner_id: string
          provider_event_at: string
          provider_record_key: string
          source_id: string
        }
        Update: {
          available_at?: string
          available_quantity?: number | null
          created_at?: string
          first_seen_at?: string
          id?: string
          instrument_id?: string
          is_available?: boolean
          owner_id?: string
          provider_event_at?: string
          provider_record_key?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'borrow_availability_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'borrow_availability_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'borrow_availability_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      borrow_costs: {
        Row: {
          annualized_rate: number
          available_at: string
          created_at: string
          first_seen_at: string
          id: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_record_key: string
          source_id: string
        }
        Insert: {
          annualized_rate: number
          available_at: string
          created_at?: string
          first_seen_at: string
          id?: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_record_key: string
          source_id: string
        }
        Update: {
          annualized_rate?: number
          available_at?: string
          created_at?: string
          first_seen_at?: string
          id?: string
          instrument_id?: string
          owner_id?: string
          provider_event_at?: string
          provider_record_key?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'borrow_costs_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'borrow_costs_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'borrow_costs_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      budget_alerts: {
        Row: {
          acknowledged_at: string | null
          amount_at_alert: number
          budget_period_id: string
          created_at: string
          emitted_at: string
          id: string
          owner_id: string
          threshold_percent: number
        }
        Insert: {
          acknowledged_at?: string | null
          amount_at_alert: number
          budget_period_id: string
          created_at?: string
          emitted_at?: string
          id?: string
          owner_id: string
          threshold_percent: number
        }
        Update: {
          acknowledged_at?: string | null
          amount_at_alert?: number
          budget_period_id?: string
          created_at?: string
          emitted_at?: string
          id?: string
          owner_id?: string
          threshold_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: 'budget_alerts_budget_period_id_owner_id_fkey'
            columns: ['budget_period_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'ai_budget_status_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'budget_alerts_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      configuration_versions: {
        Row: {
          config: Json
          config_kind: string
          content_hash: string
          created_at: string
          id: string
          name: string
          owner_id: string
          schema_version: number
          version: number
        }
        Insert: {
          config: Json
          config_kind: string
          content_hash: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          schema_version?: number
          version: number
        }
        Update: {
          config?: Json
          config_kind?: string
          content_hash?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          schema_version?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'configuration_versions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      corporate_action_applications: {
        Row: {
          adjustment: Json
          applied_at: string
          corporate_action_id: string
          correlation_id: string
          created_at: string
          effective_at: string
          experiment_id: string
          id: string
          idempotency_key: string
          owner_id: string
          simulation_account_id: string
        }
        Insert: {
          adjustment: Json
          applied_at: string
          corporate_action_id: string
          correlation_id: string
          created_at?: string
          effective_at: string
          experiment_id: string
          id?: string
          idempotency_key: string
          owner_id: string
          simulation_account_id: string
        }
        Update: {
          adjustment?: Json
          applied_at?: string
          corporate_action_id?: string
          correlation_id?: string
          created_at?: string
          effective_at?: string
          experiment_id?: string
          id?: string
          idempotency_key?: string
          owner_id?: string
          simulation_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'corporate_action_applications_corporate_action_id_owner_id_fkey'
            columns: ['corporate_action_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'corporate_actions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'corporate_action_applications_simulation_account_id_experi_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      corporate_actions: {
        Row: {
          action_type: string
          available_at: string
          content_hash: string
          details: Json
          effective_at: string
          ex_date: string | null
          first_seen_at: string
          id: string
          ingested_at: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_received_at: string | null
          provider_record_key: string
          revision_no: number
          source_id: string
          supersedes_id: string | null
        }
        Insert: {
          action_type: string
          available_at: string
          content_hash: string
          details: Json
          effective_at: string
          ex_date?: string | null
          first_seen_at: string
          id?: string
          ingested_at?: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_received_at?: string | null
          provider_record_key: string
          revision_no?: number
          source_id: string
          supersedes_id?: string | null
        }
        Update: {
          action_type?: string
          available_at?: string
          content_hash?: string
          details?: Json
          effective_at?: string
          ex_date?: string | null
          first_seen_at?: string
          id?: string
          ingested_at?: string
          instrument_id?: string
          owner_id?: string
          provider_event_at?: string
          provider_received_at?: string | null
          provider_record_key?: string
          revision_no?: number
          source_id?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'corporate_actions_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'corporate_actions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'corporate_actions_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'corporate_actions_supersedes_id_fkey'
            columns: ['supersedes_id']
            isOneToOne: false
            referencedRelation: 'corporate_actions'
            referencedColumns: ['id']
          },
        ]
      }
      decision_context_snapshots: {
        Row: {
          agent_run_id: string
          content_hash: string
          context_manifest: Json
          created_at: string
          decision_at: string
          experiment_id: string
          experiment_version_id: string
          id: string
          owner_id: string
          portfolio_snapshot_id: string | null
          strategy_version_id: string | null
        }
        Insert: {
          agent_run_id: string
          content_hash: string
          context_manifest: Json
          created_at?: string
          decision_at: string
          experiment_id: string
          experiment_version_id: string
          id?: string
          owner_id: string
          portfolio_snapshot_id?: string | null
          strategy_version_id?: string | null
        }
        Update: {
          agent_run_id?: string
          content_hash?: string
          context_manifest?: Json
          created_at?: string
          decision_at?: string
          experiment_id?: string
          experiment_version_id?: string
          id?: string
          owner_id?: string
          portfolio_snapshot_id?: string | null
          strategy_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'decision_context_snapshots_agent_run_id_owner_id_fkey'
            columns: ['agent_run_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_runs'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'decision_context_snapshots_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'decision_context_snapshots_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'decision_context_snapshots_experiment_version_id_owner_id_fkey'
            columns: ['experiment_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'decision_context_snapshots_portfolio_snapshot_id_owner_id_fkey'
            columns: ['portfolio_snapshot_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'portfolio_snapshots'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'decision_context_strategy_fk'
            columns: ['strategy_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'strategy_versions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      decision_evidence: {
        Row: {
          citation_label: string
          created_at: string
          decision_id: string
          event_revision_id: string | null
          evidence_available_at: string
          evidence_kind: string
          id: string
          knowledge_chunk_id: string | null
          market_bar_id: string | null
          market_quote_id: string | null
          owner_id: string
          prior_decision_id: string | null
        }
        Insert: {
          citation_label: string
          created_at?: string
          decision_id: string
          event_revision_id?: string | null
          evidence_available_at: string
          evidence_kind: string
          id?: string
          knowledge_chunk_id?: string | null
          market_bar_id?: string | null
          market_quote_id?: string | null
          owner_id: string
          prior_decision_id?: string | null
        }
        Update: {
          citation_label?: string
          created_at?: string
          decision_id?: string
          event_revision_id?: string | null
          evidence_available_at?: string
          evidence_kind?: string
          id?: string
          knowledge_chunk_id?: string | null
          market_bar_id?: string | null
          market_quote_id?: string | null
          owner_id?: string
          prior_decision_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'decision_evidence_decision_id_owner_id_fkey'
            columns: ['decision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_decisions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'decision_evidence_event_revision_id_fkey'
            columns: ['event_revision_id']
            isOneToOne: false
            referencedRelation: 'event_revisions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'decision_evidence_knowledge_chunk_id_fkey'
            columns: ['knowledge_chunk_id']
            isOneToOne: false
            referencedRelation: 'knowledge_chunks'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'decision_evidence_market_bar_id_fkey'
            columns: ['market_bar_id']
            isOneToOne: false
            referencedRelation: 'market_bars'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'decision_evidence_market_quote_id_fkey'
            columns: ['market_quote_id']
            isOneToOne: false
            referencedRelation: 'market_quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'decision_evidence_prior_decision_id_fkey'
            columns: ['prior_decision_id']
            isOneToOne: false
            referencedRelation: 'agent_decisions'
            referencedColumns: ['id']
          },
        ]
      }
      event_entities: {
        Row: {
          confidence: number | null
          created_at: string
          display_name: string
          entity_key: string
          entity_type: string
          event_revision_id: string
          id: string
          owner_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          display_name: string
          entity_key: string
          entity_type: string
          event_revision_id: string
          id?: string
          owner_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          display_name?: string
          entity_key?: string
          entity_type?: string
          event_revision_id?: string
          id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_entities_event_revision_id_owner_id_fkey'
            columns: ['event_revision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'event_revisions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      event_features: {
        Row: {
          computed_at: string
          created_at: string
          event_revision_id: string
          feature_version: string
          features: Json
          id: string
          owner_id: string
        }
        Insert: {
          computed_at: string
          created_at?: string
          event_revision_id: string
          feature_version: string
          features: Json
          id?: string
          owner_id: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          event_revision_id?: string
          feature_version?: string
          features?: Json
          id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_features_event_revision_id_owner_id_fkey'
            columns: ['event_revision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'event_revisions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      event_instrument_links: {
        Row: {
          confidence: number
          created_at: string
          event_revision_id: string
          id: string
          instrument_id: string
          owner_id: string
          relation_type: string
        }
        Insert: {
          confidence: number
          created_at?: string
          event_revision_id: string
          id?: string
          instrument_id: string
          owner_id: string
          relation_type: string
        }
        Update: {
          confidence?: number
          created_at?: string
          event_revision_id?: string
          id?: string
          instrument_id?: string
          owner_id?: string
          relation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_instrument_links_event_revision_id_owner_id_fkey'
            columns: ['event_revision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'event_revisions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'event_instrument_links_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
        ]
      }
      event_revisions: {
        Row: {
          author: string | null
          available_at: string
          content_hash: string
          correction_state: string
          created_at: string
          event_id: string
          first_seen_at: string
          id: string
          issuing_authority: string | null
          language: string
          licensing_metadata: Json
          owner_id: string
          provider_received_at: string | null
          published_at: string | null
          retention_until: string | null
          revision_no: number
          revision_of_id: string | null
          sanitized_text: string
          source_quality: number | null
          title: string
        }
        Insert: {
          author?: string | null
          available_at: string
          content_hash: string
          correction_state?: string
          created_at?: string
          event_id: string
          first_seen_at: string
          id?: string
          issuing_authority?: string | null
          language?: string
          licensing_metadata?: Json
          owner_id: string
          provider_received_at?: string | null
          published_at?: string | null
          retention_until?: string | null
          revision_no: number
          revision_of_id?: string | null
          sanitized_text: string
          source_quality?: number | null
          title: string
        }
        Update: {
          author?: string | null
          available_at?: string
          content_hash?: string
          correction_state?: string
          created_at?: string
          event_id?: string
          first_seen_at?: string
          id?: string
          issuing_authority?: string | null
          language?: string
          licensing_metadata?: Json
          owner_id?: string
          provider_received_at?: string | null
          published_at?: string | null
          retention_until?: string | null
          revision_no?: number
          revision_of_id?: string | null
          sanitized_text?: string
          source_quality?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_revisions_event_id_owner_id_fkey'
            columns: ['event_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'news_events'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'event_revisions_revision_of_id_fkey'
            columns: ['revision_of_id']
            isOneToOne: false
            referencedRelation: 'event_revisions'
            referencedColumns: ['id']
          },
        ]
      }
      event_scores: {
        Row: {
          created_at: string
          event_revision_id: string
          id: string
          materiality: number | null
          novelty: number | null
          owner_id: string
          relevance: number | null
          scored_at: string
          scoring_version: string
        }
        Insert: {
          created_at?: string
          event_revision_id: string
          id?: string
          materiality?: number | null
          novelty?: number | null
          owner_id: string
          relevance?: number | null
          scored_at: string
          scoring_version: string
        }
        Update: {
          created_at?: string
          event_revision_id?: string
          id?: string
          materiality?: number | null
          novelty?: number | null
          owner_id?: string
          relevance?: number | null
          scored_at?: string
          scoring_version?: string
        }
        Relationships: [
          {
            foreignKeyName: 'event_scores_event_revision_id_owner_id_fkey'
            columns: ['event_revision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'event_revisions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      exchanges: {
        Row: {
          country_code: string
          created_at: string
          id: string
          mic: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country_code: string
          created_at?: string
          id?: string
          mic: string
          name: string
          timezone: string
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          id?: string
          mic?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      experiment_benchmarks: {
        Row: {
          created_at: string
          experiment_id: string
          id: string
          instrument_id: string
          owner_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          experiment_id: string
          id?: string
          instrument_id: string
          owner_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          experiment_id?: string
          id?: string
          instrument_id?: string
          owner_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: 'experiment_benchmarks_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_benchmarks_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_benchmarks_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
        ]
      }
      experiment_controls: {
        Row: {
          agent_enabled: boolean
          created_at: string
          emergency_paused: boolean
          experiment_id: string
          owner_id: string
          pause_reason: string | null
          scheduler_enabled: boolean
          state_version: number
          updated_at: string
        }
        Insert: {
          agent_enabled?: boolean
          created_at?: string
          emergency_paused?: boolean
          experiment_id: string
          owner_id: string
          pause_reason?: string | null
          scheduler_enabled?: boolean
          state_version?: number
          updated_at?: string
        }
        Update: {
          agent_enabled?: boolean
          created_at?: string
          emergency_paused?: boolean
          experiment_id?: string
          owner_id?: string
          pause_reason?: string | null
          scheduler_enabled?: boolean
          state_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'experiment_controls_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: true
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_controls_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: true
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      experiment_start_manifests: {
        Row: {
          content_hash: string
          created_at: string
          definition: Json
          id: string
          manifest_id: string
          owner_id: string
          reviewed_at: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          definition: Json
          id?: string
          manifest_id: string
          owner_id: string
          reviewed_at: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          definition?: Json
          id?: string
          manifest_id?: string
          owner_id?: string
          reviewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'experiment_start_manifests_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      experiment_status_events: {
        Row: {
          actor_type: string
          correlation_id: string
          experiment_id: string
          from_execution_mode: string | null
          from_status: string | null
          id: string
          occurred_at: string
          owner_id: string
          reason: string | null
          reason_code: string | null
          to_execution_mode: string | null
          to_status: string
        }
        Insert: {
          actor_type: string
          correlation_id: string
          experiment_id: string
          from_execution_mode?: string | null
          from_status?: string | null
          id?: string
          occurred_at?: string
          owner_id: string
          reason?: string | null
          reason_code?: string | null
          to_execution_mode?: string | null
          to_status: string
        }
        Update: {
          actor_type?: string
          correlation_id?: string
          experiment_id?: string
          from_execution_mode?: string | null
          from_status?: string | null
          id?: string
          occurred_at?: string
          owner_id?: string
          reason?: string | null
          reason_code?: string | null
          to_execution_mode?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'experiment_status_events_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_status_events_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      experiment_versions: {
        Row: {
          agent_prompt_version_id: string | null
          base_currency: string
          budget_policy_id: string | null
          content_hash: string
          created_at: string
          data_source_config_version_id: string
          experiment_id: string
          id: string
          initial_capital: number
          knowledge_corpus_version_id: string | null
          market_calendar_manifest_id: string | null
          market_universe_id: string
          model_routing_version_id: string
          objective: string
          owner_id: string
          resolved_rules: Json
          risk_config_version_id: string
          simulator_config_version_id: string
          start_manifest_id: string | null
          version: number
        }
        Insert: {
          agent_prompt_version_id?: string | null
          base_currency: string
          budget_policy_id?: string | null
          content_hash: string
          created_at?: string
          data_source_config_version_id: string
          experiment_id: string
          id?: string
          initial_capital: number
          knowledge_corpus_version_id?: string | null
          market_calendar_manifest_id?: string | null
          market_universe_id: string
          model_routing_version_id: string
          objective: string
          owner_id: string
          resolved_rules: Json
          risk_config_version_id: string
          simulator_config_version_id: string
          start_manifest_id?: string | null
          version: number
        }
        Update: {
          agent_prompt_version_id?: string | null
          base_currency?: string
          budget_policy_id?: string | null
          content_hash?: string
          created_at?: string
          data_source_config_version_id?: string
          experiment_id?: string
          id?: string
          initial_capital?: number
          knowledge_corpus_version_id?: string | null
          market_calendar_manifest_id?: string | null
          market_universe_id?: string
          model_routing_version_id?: string
          objective?: string
          owner_id?: string
          resolved_rules?: Json
          risk_config_version_id?: string
          simulator_config_version_id?: string
          start_manifest_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'experiment_versions_budget_policy_fk'
            columns: ['budget_policy_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'ai_budget_policies'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_corpus_fk'
            columns: ['knowledge_corpus_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'knowledge_corpus_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_data_source_config_version_id_owner_id_fkey'
            columns: ['data_source_config_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'configuration_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_market_universe_id_owner_id_fkey'
            columns: ['market_universe_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'market_universes'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_market_calendar_manifest_fk'
            columns: ['market_calendar_manifest_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'market_calendar_manifests'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_model_routing_version_id_owner_id_fkey'
            columns: ['model_routing_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'configuration_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_prompt_fk'
            columns: ['agent_prompt_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'prompt_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_risk_config_version_id_owner_id_fkey'
            columns: ['risk_config_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'configuration_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_simulator_config_version_id_owner_id_fkey'
            columns: ['simulator_config_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'configuration_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiment_versions_start_manifest_fk'
            columns: ['start_manifest_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_start_manifests'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      experiments: {
        Row: {
          base_currency: string
          created_at: string
          draft_revision: number
          ends_at: string | null
          execution_mode: string | null
          id: string
          initial_capital: number
          lifecycle_status: string
          locked_at: string | null
          locked_version_id: string | null
          name: string
          objective: string
          owner_id: string
          pause_reason: string | null
          source_experiment_id: string | null
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          draft_revision?: number
          ends_at?: string | null
          execution_mode?: string | null
          id?: string
          initial_capital: number
          lifecycle_status?: string
          locked_at?: string | null
          locked_version_id?: string | null
          name: string
          objective: string
          owner_id: string
          pause_reason?: string | null
          source_experiment_id?: string | null
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          draft_revision?: number
          ends_at?: string | null
          execution_mode?: string | null
          id?: string
          initial_capital?: number
          lifecycle_status?: string
          locked_at?: string | null
          locked_version_id?: string | null
          name?: string
          objective?: string
          owner_id?: string
          pause_reason?: string | null
          source_experiment_id?: string | null
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'experiments_locked_version_fk'
            columns: ['locked_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiments_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'experiments_source_experiment_fk'
            columns: ['source_experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiments_source_experiment_fk'
            columns: ['source_experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      fill_market_data_refs: {
        Row: {
          bar_id: string | null
          created_at: string
          fill_id: string
          fx_rate_id: string | null
          id: string
          owner_id: string
          quote_id: string | null
          role: string
        }
        Insert: {
          bar_id?: string | null
          created_at?: string
          fill_id: string
          fx_rate_id?: string | null
          id?: string
          owner_id: string
          quote_id?: string | null
          role: string
        }
        Update: {
          bar_id?: string | null
          created_at?: string
          fill_id?: string
          fx_rate_id?: string | null
          id?: string
          owner_id?: string
          quote_id?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fill_market_data_refs_bar_id_fkey'
            columns: ['bar_id']
            isOneToOne: false
            referencedRelation: 'market_bars'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fill_market_data_refs_fill_id_owner_id_fkey'
            columns: ['fill_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'fills'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'fill_market_data_refs_fx_rate_id_fkey'
            columns: ['fx_rate_id']
            isOneToOne: false
            referencedRelation: 'fx_rates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fill_market_data_refs_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'market_quotes'
            referencedColumns: ['id']
          },
        ]
      }
      fills: {
        Row: {
          base_currency: string
          base_market_price: number
          base_notional: number
          commission: number
          correlation_id: string
          created_at: string
          execution_price: number
          experiment_id: string
          filled_at: string
          fx_rate_id: string | null
          id: string
          idempotency_key: string
          instrument_id: string
          market_bar_id: string | null
          market_quote_id: string | null
          notional: number
          observed_at: string
          opportunity_at: string
          order_id: string
          owner_id: string
          quantity: number
          quote_currency: string
          regulatory_fee: number
          simulation_account_id: string
          simulator_config_version_id: string
          slippage_amount: number
        }
        Insert: {
          base_currency: string
          base_market_price: number
          base_notional: number
          commission?: number
          correlation_id: string
          created_at?: string
          execution_price: number
          experiment_id: string
          filled_at: string
          fx_rate_id?: string | null
          id?: string
          idempotency_key: string
          instrument_id: string
          market_bar_id?: string | null
          market_quote_id?: string | null
          notional: number
          observed_at: string
          opportunity_at: string
          order_id: string
          owner_id: string
          quantity: number
          quote_currency: string
          regulatory_fee?: number
          simulation_account_id: string
          simulator_config_version_id: string
          slippage_amount?: number
        }
        Update: {
          base_currency?: string
          base_market_price?: number
          base_notional?: number
          commission?: number
          correlation_id?: string
          created_at?: string
          execution_price?: number
          experiment_id?: string
          filled_at?: string
          fx_rate_id?: string | null
          id?: string
          idempotency_key?: string
          instrument_id?: string
          market_bar_id?: string | null
          market_quote_id?: string | null
          notional?: number
          observed_at?: string
          opportunity_at?: string
          order_id?: string
          owner_id?: string
          quantity?: number
          quote_currency?: string
          regulatory_fee?: number
          simulation_account_id?: string
          simulator_config_version_id?: string
          slippage_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: 'fills_fx_rate_id_fkey'
            columns: ['fx_rate_id']
            isOneToOne: false
            referencedRelation: 'fx_rates'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fills_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fills_market_bar_id_fkey'
            columns: ['market_bar_id']
            isOneToOne: false
            referencedRelation: 'market_bars'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fills_market_quote_id_fkey'
            columns: ['market_quote_id']
            isOneToOne: false
            referencedRelation: 'market_quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fills_order_id_experiment_id_owner_id_fkey'
            columns: ['order_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
          {
            foreignKeyName: 'fills_simulation_account_id_experiment_id_owner_id_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
          {
            foreignKeyName: 'fills_simulator_config_version_id_owner_id_fkey'
            columns: ['simulator_config_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'configuration_versions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      fx_rates: {
        Row: {
          available_at: string
          base_currency: string
          content_hash: string
          first_seen_at: string
          id: string
          ingested_at: string
          owner_id: string
          provider_event_at: string
          provider_received_at: string | null
          provider_record_key: string
          quote_currency: string
          rate: number
          revision_no: number
          source_id: string
          supersedes_id: string | null
        }
        Insert: {
          available_at: string
          base_currency: string
          content_hash: string
          first_seen_at: string
          id?: string
          ingested_at?: string
          owner_id: string
          provider_event_at: string
          provider_received_at?: string | null
          provider_record_key: string
          quote_currency: string
          rate: number
          revision_no?: number
          source_id: string
          supersedes_id?: string | null
        }
        Update: {
          available_at?: string
          base_currency?: string
          content_hash?: string
          first_seen_at?: string
          id?: string
          ingested_at?: string
          owner_id?: string
          provider_event_at?: string
          provider_received_at?: string | null
          provider_record_key?: string
          quote_currency?: string
          rate?: number
          revision_no?: number
          source_id?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'fx_rates_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'fx_rates_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fx_rates_supersedes_id_fkey'
            columns: ['supersedes_id']
            isOneToOne: false
            referencedRelation: 'fx_rates'
            referencedColumns: ['id']
          },
        ]
      }
      instrument_aliases: {
        Row: {
          alias: string
          created_at: string
          id: string
          instrument_id: string
          provider: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          alias: string
          created_at?: string
          id?: string
          instrument_id: string
          provider: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          alias?: string
          created_at?: string
          id?: string
          instrument_id?: string
          provider?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'instrument_aliases_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
        ]
      }
      instruments: {
        Row: {
          active_from: string | null
          active_to: string | null
          asset_class: string
          created_at: string
          currency: string
          id: string
          is_shortable: boolean
          is_tradable: boolean
          name: string
          price_increment: number
          primary_exchange_id: string
          quantity_increment: number
          symbol: string
          updated_at: string
        }
        Insert: {
          active_from?: string | null
          active_to?: string | null
          asset_class: string
          created_at?: string
          currency: string
          id?: string
          is_shortable?: boolean
          is_tradable?: boolean
          name: string
          price_increment: number
          primary_exchange_id: string
          quantity_increment: number
          symbol: string
          updated_at?: string
        }
        Update: {
          active_from?: string | null
          active_to?: string | null
          asset_class?: string
          created_at?: string
          currency?: string
          id?: string
          is_shortable?: boolean
          is_tradable?: boolean
          name?: string
          price_increment?: number
          primary_exchange_id?: string
          quantity_increment?: number
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'instruments_primary_exchange_id_fkey'
            columns: ['primary_exchange_id']
            isOneToOne: false
            referencedRelation: 'exchanges'
            referencedColumns: ['id']
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          available_at: string
          chunk_index: number
          content_hash: string
          created_at: string
          document_version_id: string
          embedding: string | null
          entities: Json
          id: string
          instrument_ids: string[]
          owner_id: string
          plain_text: string
          search_vector: unknown
          source_quality: number | null
          tags: string[]
          token_estimate: number
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          available_at: string
          chunk_index: number
          content_hash: string
          created_at?: string
          document_version_id: string
          embedding?: string | null
          entities?: Json
          id?: string
          instrument_ids?: string[]
          owner_id: string
          plain_text: string
          search_vector?: unknown
          source_quality?: number | null
          tags?: string[]
          token_estimate: number
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          available_at?: string
          chunk_index?: number
          content_hash?: string
          created_at?: string
          document_version_id?: string
          embedding?: string | null
          entities?: Json
          id?: string
          instrument_ids?: string[]
          owner_id?: string
          plain_text?: string
          search_vector?: unknown
          source_quality?: number | null
          tags?: string[]
          token_estimate?: number
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_chunks_document_version_id_owner_id_fkey'
            columns: ['document_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'knowledge_document_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'knowledge_chunks_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      knowledge_corpus_members: {
        Row: {
          corpus_version_id: string
          document_version_id: string
          owner_id: string
        }
        Insert: {
          corpus_version_id: string
          document_version_id: string
          owner_id: string
        }
        Update: {
          corpus_version_id?: string
          document_version_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_corpus_members_corpus_version_id_owner_id_fkey'
            columns: ['corpus_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'knowledge_corpus_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'knowledge_corpus_members_document_version_id_owner_id_fkey'
            columns: ['document_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'knowledge_document_versions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      knowledge_corpus_versions: {
        Row: {
          available_at: string
          content_hash: string
          created_at: string
          id: string
          name: string
          owner_id: string
          version: number
        }
        Insert: {
          available_at: string
          content_hash: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          version: number
        }
        Update: {
          available_at?: string
          content_hash?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_corpus_versions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      knowledge_document_versions: {
        Row: {
          available_at: string
          content_hash: string
          created_at: string
          document_id: string
          first_seen_at: string
          id: string
          metadata: Json
          owner_id: string
          raw_storage_path: string | null
          sanitized_text: string
          valid_from: string
          valid_to: string | null
          version: number
        }
        Insert: {
          available_at: string
          content_hash: string
          created_at?: string
          document_id: string
          first_seen_at: string
          id?: string
          metadata?: Json
          owner_id: string
          raw_storage_path?: string | null
          sanitized_text: string
          valid_from: string
          valid_to?: string | null
          version: number
        }
        Update: {
          available_at?: string
          content_hash?: string
          created_at?: string
          document_id?: string
          first_seen_at?: string
          id?: string
          metadata?: Json
          owner_id?: string
          raw_storage_path?: string | null
          sanitized_text?: string
          valid_from?: string
          valid_to?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_document_versions_document_id_owner_id_fkey'
            columns: ['document_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'knowledge_documents'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'knowledge_document_versions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      knowledge_documents: {
        Row: {
          created_at: string
          external_key: string
          id: string
          knowledge_source_id: string
          owner_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_key: string
          id?: string
          knowledge_source_id: string
          owner_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_key?: string
          id?: string
          knowledge_source_id?: string
          owner_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_documents_knowledge_source_id_owner_id_fkey'
            columns: ['knowledge_source_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'knowledge_sources'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'knowledge_documents_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      knowledge_sources: {
        Row: {
          created_at: string
          id: string
          is_synthetic: boolean
          name: string
          owner_id: string
          provenance: Json
          source_id: string | null
          source_kind: string
          source_quality: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_synthetic?: boolean
          name: string
          owner_id: string
          provenance: Json
          source_id?: string | null
          source_kind: string
          source_quality?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_synthetic?: boolean
          name?: string
          owner_id?: string
          provenance?: Json
          source_id?: string | null
          source_kind?: string
          source_quality?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'knowledge_sources_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'knowledge_sources_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      lot_allocations: {
        Row: {
          allocated_close_fee: number
          allocated_open_fee: number
          closing_fill_id: string
          created_at: string
          id: string
          idempotency_key: string
          lot_id: string
          owner_id: string
          quantity: number
          realized_pnl_base: number
        }
        Insert: {
          allocated_close_fee?: number
          allocated_open_fee?: number
          closing_fill_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          lot_id: string
          owner_id: string
          quantity: number
          realized_pnl_base: number
        }
        Update: {
          allocated_close_fee?: number
          allocated_open_fee?: number
          closing_fill_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          lot_id?: string
          owner_id?: string
          quantity?: number
          realized_pnl_base?: number
        }
        Relationships: [
          {
            foreignKeyName: 'lot_allocations_closing_fill_id_owner_id_fkey'
            columns: ['closing_fill_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'fills'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'lot_allocations_lot_id_owner_id_fkey'
            columns: ['lot_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'position_lots'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      margin_snapshots: {
        Row: {
          as_of: string
          buying_power: number
          created_at: string
          equity: number
          excess_equity: number
          experiment_id: string
          id: string
          initial_requirement: number
          maintenance_requirement: number
          margin_call: boolean
          owner_id: string
          simulation_account_id: string
        }
        Insert: {
          as_of: string
          buying_power: number
          created_at?: string
          equity: number
          excess_equity: number
          experiment_id: string
          id?: string
          initial_requirement: number
          maintenance_requirement: number
          margin_call?: boolean
          owner_id: string
          simulation_account_id: string
        }
        Update: {
          as_of?: string
          buying_power?: number
          created_at?: string
          equity?: number
          excess_equity?: number
          experiment_id?: string
          id?: string
          initial_requirement?: number
          maintenance_requirement?: number
          margin_call?: boolean
          owner_id?: string
          simulation_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'margin_snapshots_simulation_account_id_experiment_id_owner_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      market_bars: {
        Row: {
          available_at: string
          bar_end: string
          bar_start: string
          close_price: number
          content_hash: string
          correction_state: string
          first_seen_at: string
          high_price: number
          id: string
          ingested_at: string
          instrument_id: string
          low_price: number
          open_price: number
          owner_id: string
          provider_event_at: string
          provider_received_at: string | null
          provider_record_key: string
          revision_no: number
          source_id: string
          supersedes_id: string | null
          timeframe: string
          volume: number
        }
        Insert: {
          available_at: string
          bar_end: string
          bar_start: string
          close_price: number
          content_hash: string
          correction_state?: string
          first_seen_at: string
          high_price: number
          id?: string
          ingested_at?: string
          instrument_id: string
          low_price: number
          open_price: number
          owner_id: string
          provider_event_at: string
          provider_received_at?: string | null
          provider_record_key: string
          revision_no?: number
          source_id: string
          supersedes_id?: string | null
          timeframe: string
          volume: number
        }
        Update: {
          available_at?: string
          bar_end?: string
          bar_start?: string
          close_price?: number
          content_hash?: string
          correction_state?: string
          first_seen_at?: string
          high_price?: number
          id?: string
          ingested_at?: string
          instrument_id?: string
          low_price?: number
          open_price?: number
          owner_id?: string
          provider_event_at?: string
          provider_received_at?: string | null
          provider_record_key?: string
          revision_no?: number
          source_id?: string
          supersedes_id?: string | null
          timeframe?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: 'market_bars_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_bars_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'market_bars_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_bars_supersedes_id_fkey'
            columns: ['supersedes_id']
            isOneToOne: false
            referencedRelation: 'market_bars'
            referencedColumns: ['id']
          },
        ]
      }
      market_quotes: {
        Row: {
          ask_price: number | null
          ask_size: number | null
          available_at: string
          bid_price: number | null
          bid_size: number | null
          content_hash: string
          correction_state: string
          first_seen_at: string
          id: string
          ingested_at: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_received_at: string | null
          provider_record_key: string
          revision_no: number
          source_id: string
          supersedes_id: string | null
        }
        Insert: {
          ask_price?: number | null
          ask_size?: number | null
          available_at: string
          bid_price?: number | null
          bid_size?: number | null
          content_hash: string
          correction_state?: string
          first_seen_at: string
          id?: string
          ingested_at?: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_received_at?: string | null
          provider_record_key: string
          revision_no?: number
          source_id: string
          supersedes_id?: string | null
        }
        Update: {
          ask_price?: number | null
          ask_size?: number | null
          available_at?: string
          bid_price?: number | null
          bid_size?: number | null
          content_hash?: string
          correction_state?: string
          first_seen_at?: string
          id?: string
          ingested_at?: string
          instrument_id?: string
          owner_id?: string
          provider_event_at?: string
          provider_received_at?: string | null
          provider_record_key?: string
          revision_no?: number
          source_id?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'market_quotes_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_quotes_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'market_quotes_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_quotes_supersedes_id_fkey'
            columns: ['supersedes_id']
            isOneToOne: false
            referencedRelation: 'market_quotes'
            referencedColumns: ['id']
          },
        ]
      }
      market_calendar_manifests: {
        Row: {
          calendar_year: number
          content_hash: string
          created_at: string
          definition: Json
          id: string
          manifest_id: string
          owner_id: string
          reviewed_at: string
          timezone: string
        }
        Insert: {
          calendar_year: number
          content_hash: string
          created_at?: string
          definition: Json
          id?: string
          manifest_id: string
          owner_id: string
          reviewed_at: string
          timezone: string
        }
        Update: {
          calendar_year?: number
          content_hash?: string
          created_at?: string
          definition?: Json
          id?: string
          manifest_id?: string
          owner_id?: string
          reviewed_at?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: 'market_calendar_manifests_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      market_sessions: {
        Row: {
          available_at: string
          calendar_manifest_id: string | null
          calendar_source_id: string | null
          closes_at: string | null
          created_at: string
          exchange_id: string
          id: string
          opens_at: string | null
          session_date: string
          session_type: string
          source_identifier: string
        }
        Insert: {
          available_at: string
          calendar_manifest_id?: string | null
          calendar_source_id?: string | null
          closes_at?: string | null
          created_at?: string
          exchange_id: string
          id?: string
          opens_at?: string | null
          session_date: string
          session_type: string
          source_identifier: string
        }
        Update: {
          available_at?: string
          calendar_manifest_id?: string | null
          calendar_source_id?: string | null
          closes_at?: string | null
          created_at?: string
          exchange_id?: string
          id?: string
          opens_at?: string | null
          session_date?: string
          session_type?: string
          source_identifier?: string
        }
        Relationships: [
          {
            foreignKeyName: 'market_sessions_calendar_manifest_id_fkey'
            columns: ['calendar_manifest_id']
            isOneToOne: false
            referencedRelation: 'market_calendar_manifests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_sessions_calendar_source_id_fkey'
            columns: ['calendar_source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_sessions_exchange_id_fkey'
            columns: ['exchange_id']
            isOneToOne: false
            referencedRelation: 'exchanges'
            referencedColumns: ['id']
          },
        ]
      }
      market_universe_members: {
        Row: {
          created_at: string
          id: string
          instrument_id: string
          owner_id: string
          universe_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          instrument_id: string
          owner_id: string
          universe_id: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          instrument_id?: string
          owner_id?: string
          universe_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'market_universe_members_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'market_universe_members_universe_id_owner_id_fkey'
            columns: ['universe_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'market_universes'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      market_universes: {
        Row: {
          content_hash: string
          created_at: string
          description: string | null
          id: string
          locked_at: string | null
          name: string
          owner_id: string
          version: number
        }
        Insert: {
          content_hash: string
          created_at?: string
          description?: string | null
          id?: string
          locked_at?: string | null
          name: string
          owner_id: string
          version: number
        }
        Update: {
          content_hash?: string
          created_at?: string
          description?: string | null
          id?: string
          locked_at?: string | null
          name?: string
          owner_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'market_universes_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      memory_summaries: {
        Row: {
          agent_run_id: string | null
          available_at: string
          created_at: string
          experiment_id: string
          generated_by: string
          id: string
          owner_id: string
          period_end: string
          period_start: string
          summary: Json
          summary_type: string
        }
        Insert: {
          agent_run_id?: string | null
          available_at: string
          created_at?: string
          experiment_id: string
          generated_by: string
          id?: string
          owner_id: string
          period_end: string
          period_start: string
          summary: Json
          summary_type: string
        }
        Update: {
          agent_run_id?: string | null
          available_at?: string
          created_at?: string
          experiment_id?: string
          generated_by?: string
          id?: string
          owner_id?: string
          period_end?: string
          period_start?: string
          summary?: Json
          summary_type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'memory_summaries_agent_run_id_owner_id_fkey'
            columns: ['agent_run_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_runs'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'memory_summaries_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'memory_summaries_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      model_pricing: {
        Row: {
          cache_write_per_million: number
          cached_input_per_million: number
          context_tier: string
          created_at: string
          currency: string
          effective_from: string
          effective_to: string | null
          id: string
          input_per_million: number
          is_verified: boolean
          model: string
          output_per_million: number
          pricing_mode: string
          provider: string
          source_url: string
          tool_call_price: number
        }
        Insert: {
          cache_write_per_million?: number
          cached_input_per_million?: number
          context_tier?: string
          created_at?: string
          currency?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          input_per_million?: number
          is_verified?: boolean
          model: string
          output_per_million?: number
          pricing_mode: string
          provider?: string
          source_url: string
          tool_call_price?: number
        }
        Update: {
          cache_write_per_million?: number
          cached_input_per_million?: number
          context_tier?: string
          created_at?: string
          currency?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          input_per_million?: number
          is_verified?: boolean
          model?: string
          output_per_million?: number
          pricing_mode?: string
          provider?: string
          source_url?: string
          tool_call_price?: number
        }
        Relationships: []
      }
      model_routing_events: {
        Row: {
          agent_run_id: string | null
          correlation_id: string
          created_at: string
          details: Json
          experiment_id: string
          from_role: string | null
          id: string
          occurred_at: string
          outcome: string
          owner_id: string
          reason_code: string
          to_role: string | null
        }
        Insert: {
          agent_run_id?: string | null
          correlation_id: string
          created_at?: string
          details?: Json
          experiment_id: string
          from_role?: string | null
          id?: string
          occurred_at: string
          outcome: string
          owner_id: string
          reason_code: string
          to_role?: string | null
        }
        Update: {
          agent_run_id?: string | null
          correlation_id?: string
          created_at?: string
          details?: Json
          experiment_id?: string
          from_role?: string | null
          id?: string
          occurred_at?: string
          outcome?: string
          owner_id?: string
          reason_code?: string
          to_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'model_routing_events_agent_run_id_owner_id_fkey'
            columns: ['agent_run_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_runs'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'model_routing_events_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'model_routing_events_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      news_events: {
        Row: {
          canonical_url: string | null
          created_at: string
          external_id: string
          first_seen_at: string
          id: string
          owner_id: string
          source_id: string
          source_type: string
        }
        Insert: {
          canonical_url?: string | null
          created_at?: string
          external_id: string
          first_seen_at: string
          id?: string
          owner_id: string
          source_id: string
          source_type: string
        }
        Update: {
          canonical_url?: string | null
          created_at?: string
          external_id?: string
          first_seen_at?: string
          id?: string
          owner_id?: string
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: 'news_events_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'news_events_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      order_status_events: {
        Row: {
          correlation_id: string
          created_at: string
          experiment_id: string
          from_status: string | null
          id: string
          idempotency_key: string
          occurred_at: string
          order_id: string
          owner_id: string
          reason_code: string | null
          reason_detail: Json
          to_status: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          experiment_id: string
          from_status?: string | null
          id?: string
          idempotency_key: string
          occurred_at: string
          order_id: string
          owner_id: string
          reason_code?: string | null
          reason_detail?: Json
          to_status: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          experiment_id?: string
          from_status?: string | null
          id?: string
          idempotency_key?: string
          occurred_at?: string
          order_id?: string
          owner_id?: string
          reason_code?: string | null
          reason_detail?: Json
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'order_status_events_order_id_experiment_id_owner_id_fkey'
            columns: ['order_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      orders: {
        Row: {
          agent_decision_id: string | null
          created_at: string
          current_status: string
          decision_at: string
          eligible_at: string
          experiment_id: string
          experiment_version_id: string
          expires_at: string | null
          filled_quantity: number
          id: string
          idempotency_key: string
          instrument_id: string
          limit_price: number | null
          order_type: string
          owner_id: string
          quantity: number
          side: string
          simulation_account_id: string
          stop_price: number | null
          submitted_at: string
          time_in_force: string
          trigger_at: string | null
          updated_at: string
        }
        Insert: {
          agent_decision_id?: string | null
          created_at?: string
          current_status?: string
          decision_at: string
          eligible_at: string
          experiment_id: string
          experiment_version_id: string
          expires_at?: string | null
          filled_quantity?: number
          id?: string
          idempotency_key: string
          instrument_id: string
          limit_price?: number | null
          order_type: string
          owner_id: string
          quantity: number
          side: string
          simulation_account_id: string
          stop_price?: number | null
          submitted_at: string
          time_in_force: string
          trigger_at?: string | null
          updated_at?: string
        }
        Update: {
          agent_decision_id?: string | null
          created_at?: string
          current_status?: string
          decision_at?: string
          eligible_at?: string
          experiment_id?: string
          experiment_version_id?: string
          expires_at?: string | null
          filled_quantity?: number
          id?: string
          idempotency_key?: string
          instrument_id?: string
          limit_price?: number | null
          order_type?: string
          owner_id?: string
          quantity?: number
          side?: string
          simulation_account_id?: string
          stop_price?: number | null
          submitted_at?: string
          time_in_force?: string
          trigger_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'orders_agent_decision_fk'
            columns: ['agent_decision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_decisions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'orders_experiment_version_id_owner_id_fkey'
            columns: ['experiment_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'orders_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'orders_simulation_account_id_experiment_id_owner_id_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      pattern_evidence: {
        Row: {
          created_at: string
          decision_id: string | null
          evidence: Json
          evidence_type: string
          id: string
          observed_at: string
          outcome_id: string | null
          owner_id: string
          pattern_id: string
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          evidence: Json
          evidence_type: string
          id?: string
          observed_at: string
          outcome_id?: string | null
          owner_id: string
          pattern_id: string
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          evidence?: Json
          evidence_type?: string
          id?: string
          observed_at?: string
          outcome_id?: string | null
          owner_id?: string
          pattern_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pattern_evidence_decision_id_owner_id_fkey'
            columns: ['decision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_decisions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'pattern_evidence_outcome_id_owner_id_fkey'
            columns: ['outcome_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'trade_outcomes'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'pattern_evidence_pattern_id_owner_id_fkey'
            columns: ['pattern_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'pattern_hypotheses'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      pattern_hypotheses: {
        Row: {
          created_at: string
          experiment_id: string | null
          gate_config: Json
          hypothesis: string
          id: string
          lifecycle_status: string
          name: string
          owner_id: string
          proposed_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          experiment_id?: string | null
          gate_config: Json
          hypothesis: string
          id?: string
          lifecycle_status?: string
          name: string
          owner_id: string
          proposed_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          experiment_id?: string | null
          gate_config?: Json
          hypothesis?: string
          id?: string
          lifecycle_status?: string
          name?: string
          owner_id?: string
          proposed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'pattern_hypotheses_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'pattern_hypotheses_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'pattern_hypotheses_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      portfolio_snapshots: {
        Row: {
          as_of: string
          base_currency: string
          buying_power: number
          cash_value: number
          created_at: string
          drawdown_fraction: number
          experiment_id: string
          gross_exposure: number
          high_water_mark: number
          id: string
          long_market_value: number
          net_exposure: number
          net_liquidation_value: number
          owner_id: string
          realized_pnl: number
          short_market_value: number
          simulation_account_id: string
          unrealized_pnl: number
          valuation_inputs: Json
        }
        Insert: {
          as_of: string
          base_currency: string
          buying_power: number
          cash_value: number
          created_at?: string
          drawdown_fraction: number
          experiment_id: string
          gross_exposure: number
          high_water_mark: number
          id?: string
          long_market_value: number
          net_exposure: number
          net_liquidation_value: number
          owner_id: string
          realized_pnl: number
          short_market_value: number
          simulation_account_id: string
          unrealized_pnl: number
          valuation_inputs: Json
        }
        Update: {
          as_of?: string
          base_currency?: string
          buying_power?: number
          cash_value?: number
          created_at?: string
          drawdown_fraction?: number
          experiment_id?: string
          gross_exposure?: number
          high_water_mark?: number
          id?: string
          long_market_value?: number
          net_exposure?: number
          net_liquidation_value?: number
          owner_id?: string
          realized_pnl?: number
          short_market_value?: number
          simulation_account_id?: string
          unrealized_pnl?: number
          valuation_inputs?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'portfolio_snapshots_simulation_account_id_experiment_id_ow_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      position_lots: {
        Row: {
          base_notional: number
          closed_at: string | null
          created_at: string
          experiment_id: string
          id: string
          instrument_id: string
          open_fee_remaining: number
          open_price: number
          opened_at: string
          opening_fill_id: string
          original_quantity: number
          owner_id: string
          remaining_quantity: number
          side: string
          simulation_account_id: string
          updated_at: string
        }
        Insert: {
          base_notional: number
          closed_at?: string | null
          created_at?: string
          experiment_id: string
          id?: string
          instrument_id: string
          open_fee_remaining?: number
          open_price: number
          opened_at: string
          opening_fill_id: string
          original_quantity: number
          owner_id: string
          remaining_quantity: number
          side: string
          simulation_account_id: string
          updated_at?: string
        }
        Update: {
          base_notional?: number
          closed_at?: string | null
          created_at?: string
          experiment_id?: string
          id?: string
          instrument_id?: string
          open_fee_remaining?: number
          open_price?: number
          opened_at?: string
          opening_fill_id?: string
          original_quantity?: number
          owner_id?: string
          remaining_quantity?: number
          side?: string
          simulation_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'position_lots_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'position_lots_opening_fill_id_owner_id_fkey'
            columns: ['opening_fill_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'fills'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'position_lots_simulation_account_id_experiment_id_owner_id_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      positions: {
        Row: {
          as_of: string
          average_open_price: number | null
          created_at: string
          experiment_id: string
          id: string
          instrument_id: string
          owner_id: string
          projection_version: number
          quantity: number
          realized_pnl_base: number
          simulation_account_id: string
          updated_at: string
        }
        Insert: {
          as_of: string
          average_open_price?: number | null
          created_at?: string
          experiment_id: string
          id?: string
          instrument_id: string
          owner_id: string
          projection_version?: number
          quantity: number
          realized_pnl_base?: number
          simulation_account_id: string
          updated_at?: string
        }
        Update: {
          as_of?: string
          average_open_price?: number | null
          created_at?: string
          experiment_id?: string
          id?: string
          instrument_id?: string
          owner_id?: string
          projection_version?: number
          quantity?: number
          realized_pnl_base?: number
          simulation_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'positions_instrument_id_fkey'
            columns: ['instrument_id']
            isOneToOne: false
            referencedRelation: 'instruments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'positions_simulation_account_id_experiment_id_owner_id_fkey'
            columns: ['simulation_account_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'simulation_accounts'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      prompt_versions: {
        Row: {
          agent_role: string
          content_hash: string
          created_at: string
          id: string
          output_schema: Json
          owner_id: string
          system_prompt: string
          version: number
        }
        Insert: {
          agent_role: string
          content_hash: string
          created_at?: string
          id?: string
          output_schema: Json
          owner_id: string
          system_prompt: string
          version: number
        }
        Update: {
          agent_role?: string
          content_hash?: string
          created_at?: string
          id?: string
          output_schema?: Json
          owner_id?: string
          system_prompt?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'prompt_versions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      risk_events: {
        Row: {
          agent_decision_id: string | null
          correlation_id: string
          created_at: string
          details: Json
          event_type: string
          experiment_id: string
          id: string
          occurred_at: string
          order_id: string | null
          owner_id: string
          reason_code: string
          severity: string
        }
        Insert: {
          agent_decision_id?: string | null
          correlation_id: string
          created_at?: string
          details?: Json
          event_type: string
          experiment_id: string
          id?: string
          occurred_at: string
          order_id?: string | null
          owner_id: string
          reason_code: string
          severity: string
        }
        Update: {
          agent_decision_id?: string | null
          correlation_id?: string
          created_at?: string
          details?: Json
          event_type?: string
          experiment_id?: string
          id?: string
          occurred_at?: string
          order_id?: string | null
          owner_id?: string
          reason_code?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: 'risk_events_agent_decision_fk'
            columns: ['agent_decision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_decisions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'risk_events_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'risk_events_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'risk_events_order_fk'
            columns: ['order_id', 'experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'orders'
            referencedColumns: ['id', 'experiment_id', 'owner_id']
          },
        ]
      }
      simulation_accounts: {
        Row: {
          base_currency: string
          closed_at: string | null
          created_at: string
          experiment_id: string
          id: string
          opened_at: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          base_currency: string
          closed_at?: string | null
          created_at?: string
          experiment_id: string
          id?: string
          opened_at: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          closed_at?: string | null
          created_at?: string
          experiment_id?: string
          id?: string
          opened_at?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'simulation_accounts_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'simulation_accounts_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      simulator_runs: {
        Row: {
          correlation_id: string
          created_at: string
          error_class: string | null
          experiment_id: string
          finished_at: string | null
          id: string
          metadata: Json
          owner_id: string
          simulator_config_version_id: string
          slot_key: string
          started_at: string
          status: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          error_class?: string | null
          experiment_id: string
          finished_at?: string | null
          id?: string
          metadata?: Json
          owner_id: string
          simulator_config_version_id: string
          slot_key: string
          started_at: string
          status: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          error_class?: string | null
          experiment_id?: string
          finished_at?: string | null
          id?: string
          metadata?: Json
          owner_id?: string
          simulator_config_version_id?: string
          slot_key?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'simulator_runs_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'simulator_runs_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'simulator_runs_simulator_config_version_id_owner_id_fkey'
            columns: ['simulator_config_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'configuration_versions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      source_health: {
        Row: {
          checked_at: string
          created_at: string
          error_class: string | null
          id: string
          last_success_at: string | null
          latency_ms: number | null
          metadata: Json
          owner_id: string
          source_id: string
          status: string
        }
        Insert: {
          checked_at: string
          created_at?: string
          error_class?: string | null
          id?: string
          last_success_at?: string | null
          latency_ms?: number | null
          metadata?: Json
          owner_id: string
          source_id: string
          status: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          error_class?: string | null
          id?: string
          last_success_at?: string | null
          latency_ms?: number | null
          metadata?: Json
          owner_id?: string
          source_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'source_health_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'source_health_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      source_policies: {
        Row: {
          allowed_use: string
          created_at: string
          effective_from: string
          effective_to: string | null
          enabled: boolean
          id: string
          licensing_metadata: Json
          requires_authentication: boolean
          retention_days: number | null
          source_id: string
          version: number
        }
        Insert: {
          allowed_use: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          enabled?: boolean
          id?: string
          licensing_metadata?: Json
          requires_authentication?: boolean
          retention_days?: number | null
          source_id: string
          version: number
        }
        Update: {
          allowed_use?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          enabled?: boolean
          id?: string
          licensing_metadata?: Json
          requires_authentication?: boolean
          retention_days?: number | null
          source_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'source_policies_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      sources: {
        Row: {
          base_url: string | null
          code: string
          created_at: string
          id: string
          is_enabled: boolean
          is_mock: boolean
          name: string
          provider: string
          source_type: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          code: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_mock?: boolean
          name: string
          provider: string
          source_type: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          code?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_mock?: boolean
          name?: string
          provider?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      strategy_assignments: {
        Row: {
          allocation_fraction: number
          assignment_type: string
          created_at: string
          experiment_id: string
          id: string
          owner_id: string
          promotion_evidence: Json
          strategy_version_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          allocation_fraction: number
          assignment_type: string
          created_at?: string
          experiment_id: string
          id?: string
          owner_id: string
          promotion_evidence?: Json
          strategy_version_id: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          allocation_fraction?: number
          assignment_type?: string
          created_at?: string
          experiment_id?: string
          id?: string
          owner_id?: string
          promotion_evidence?: Json
          strategy_version_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'strategy_assignments_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'strategy_assignments_experiment_id_owner_id_fkey'
            columns: ['experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'strategy_assignments_strategy_version_id_owner_id_fkey'
            columns: ['strategy_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'strategy_versions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      strategy_versions: {
        Row: {
          config: Json
          content_hash: string
          created_at: string
          id: string
          name: string
          owner_id: string
          version: number
        }
        Insert: {
          config: Json
          content_hash: string
          created_at?: string
          id?: string
          name: string
          owner_id: string
          version: number
        }
        Update: {
          config?: Json
          content_hash?: string
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'strategy_versions_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
        ]
      }
      trade_outcomes: {
        Row: {
          benchmark_relative_return: number | null
          created_at: string
          decision_id: string
          evaluated_at: string
          execution_outcome: Json
          forward_return: number | null
          horizon: string
          id: string
          maximum_adverse_excursion: number | null
          maximum_favorable_excursion: number | null
          owner_id: string
          thesis_valid: boolean | null
        }
        Insert: {
          benchmark_relative_return?: number | null
          created_at?: string
          decision_id: string
          evaluated_at: string
          execution_outcome?: Json
          forward_return?: number | null
          horizon: string
          id?: string
          maximum_adverse_excursion?: number | null
          maximum_favorable_excursion?: number | null
          owner_id: string
          thesis_valid?: boolean | null
        }
        Update: {
          benchmark_relative_return?: number | null
          created_at?: string
          decision_id?: string
          evaluated_at?: string
          execution_outcome?: Json
          forward_return?: number | null
          horizon?: string
          id?: string
          maximum_adverse_excursion?: number | null
          maximum_favorable_excursion?: number | null
          owner_id?: string
          thesis_valid?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: 'trade_outcomes_decision_id_owner_id_fkey'
            columns: ['decision_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'agent_decisions'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
    }
    Views: {
      ai_budget_status_view: {
        Row: {
          budget_policy_id: string | null
          hard_limit: number | null
          id: string | null
          owner_id: string | null
          period_end: string | null
          period_kind: string | null
          period_start: string | null
          remaining_amount: number | null
          reserved_amount: number | null
          settled_amount: number | null
          soft_limit: number | null
          unknown_amount: number | null
          updated_at: string | null
        }
        Insert: {
          budget_policy_id?: string | null
          hard_limit?: number | null
          id?: string | null
          owner_id?: string | null
          period_end?: string | null
          period_kind?: string | null
          period_start?: string | null
          remaining_amount?: never
          reserved_amount?: number | null
          settled_amount?: number | null
          soft_limit?: number | null
          unknown_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          budget_policy_id?: string | null
          hard_limit?: number | null
          id?: string | null
          owner_id?: string | null
          period_end?: string | null
          period_kind?: string | null
          period_start?: string | null
          remaining_amount?: never
          reserved_amount?: number | null
          settled_amount?: number | null
          soft_limit?: number | null
          unknown_amount?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_usage_view: {
        Row: {
          actual_cost: number | null
          agent_run_id: string | null
          cache_write_tokens: number | null
          cached_input_tokens: number | null
          call_kind: string | null
          experiment_id: string | null
          finish_state: string | null
          id: string | null
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          occurred_at: string | null
          output_tokens: number | null
          owner_id: string | null
          reasoning_tokens: number | null
          tool_calls: number | null
          web_search_calls: number | null
        }
        Relationships: []
      }
      audit_log_view: {
        Row: {
          action: string | null
          actor_type: string | null
          correlation_id: string | null
          experiment_id: string | null
          id: string | null
          metadata: Json | null
          occurred_at: string | null
          owner_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action?: string | null
          actor_type?: string | null
          correlation_id?: string | null
          experiment_id?: string | null
          id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          owner_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string | null
          actor_type?: string | null
          correlation_id?: string | null
          experiment_id?: string | null
          id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          owner_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      cash_ledger_view: {
        Row: {
          amount: number | null
          correlation_id: string | null
          created_at: string | null
          currency: string | null
          effective_at: string | null
          entry_type: string | null
          experiment_id: string | null
          id: string | null
          owner_id: string | null
          simulation_account_id: string | null
          source_component: string | null
          source_id: string | null
          source_type: string | null
        }
        Insert: {
          amount?: number | null
          correlation_id?: string | null
          created_at?: string | null
          currency?: string | null
          effective_at?: string | null
          entry_type?: string | null
          experiment_id?: string | null
          id?: string | null
          owner_id?: string | null
          simulation_account_id?: string | null
          source_component?: string | null
          source_id?: string | null
          source_type?: string | null
        }
        Update: {
          amount?: number | null
          correlation_id?: string | null
          created_at?: string | null
          currency?: string | null
          effective_at?: string | null
          entry_type?: string | null
          experiment_id?: string | null
          id?: string | null
          owner_id?: string | null
          simulation_account_id?: string | null
          source_component?: string | null
          source_id?: string | null
          source_type?: string | null
        }
        Relationships: []
      }
      experiment_detail_read_view: {
        Row: {
          agent_enabled: boolean | null
          agent_prompt_version_id: string | null
          base_currency: string | null
          budget_policy_id: string | null
          control_created_at: string | null
          control_pause_reason: string | null
          control_state_version: string | null
          control_updated_at: string | null
          created_at: string | null
          data_source_config_version_id: string | null
          draft_revision: string | null
          emergency_paused: boolean | null
          ends_at: string | null
          execution_mode: string | null
          id: string | null
          initial_capital: string | null
          knowledge_corpus_version_id: string | null
          lifecycle_pause_reason: string | null
          lifecycle_status: string | null
          locked_at: string | null
          locked_base_currency: string | null
          locked_initial_capital: string | null
          locked_objective: string | null
          locked_version: number | null
          locked_version_content_hash: string | null
          locked_version_created_at: string | null
          locked_version_id: string | null
          market_calendar_manifest_id: string | null
          market_universe_id: string | null
          model_routing_version_id: string | null
          name: string | null
          objective: string | null
          owner_id: string | null
          risk_config_version_id: string | null
          scheduler_enabled: boolean | null
          simulator_config_version_id: string | null
          source_experiment_id: string | null
          start_manifest_id: string | null
          starts_at: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'experiments_locked_version_fk'
            columns: ['locked_version_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_versions'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiments_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'app_users'
            referencedColumns: ['user_id']
          },
          {
            foreignKeyName: 'experiments_source_experiment_fk'
            columns: ['source_experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiment_detail_read_view'
            referencedColumns: ['id', 'owner_id']
          },
          {
            foreignKeyName: 'experiments_source_experiment_fk'
            columns: ['source_experiment_id', 'owner_id']
            isOneToOne: false
            referencedRelation: 'experiments'
            referencedColumns: ['id', 'owner_id']
          },
        ]
      }
      scheduler_health_view: {
        Row: {
          error_class: string | null
          experiment_id: string | null
          finished_at: string | null
          id: string | null
          owner_id: string | null
          retry_eligible: boolean | null
          skipped_reason: string | null
          slot_key: string | null
          started_at: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_scheduler_slot: {
        Args: {
          p_exchange_session_id: string
          p_experiment_id: string
          p_job_type: string
          p_lease_seconds?: number
          p_owner_id: string
          p_scheduler_provider: string
          p_slot_at: string
          p_slot_key: string
        }
        Returns: Json
      }
      begin_manual_hosted_market_ingestion: {
        Args: {
          p_operation_id: string
          p_window_end: string
          p_window_start: string
        }
        Returns: {
          ingestion_run_id: string
          operation_id: string
          replayed: boolean
          source_id: string
          started_at: string
          status: string
          symbols: string[]
          window_end: string
          window_start: string
        }[]
      }
      bootstrap_first_owner: { Args: never; Returns: Json }
      commit_manual_hosted_market_ingestion: {
        Args: {
          p_bars: Json
          p_latency_ms: number
          p_operation_id: string
          p_quotes: Json
          p_request_metadata: Json
        }
        Returns: {
          finished_at: string
          ingestion_run_id: string
          operation_id: string
          records_inserted: number
          records_rejected: number
          records_reused: number
          records_seen: number
          replayed: boolean
          source_id: string
          status: string
        }[]
      }
      configure_hosted_official_calendar_manifest: {
        Args: { p_operation_id: string }
        Returns: {
          manifest_record_id: string
          operation_id: string
          replayed: boolean
          session_count: number
          source_count: number
          status: string
        }[]
      }
      configure_hosted_market_manifest: {
        Args: { p_operation_id: string }
        Returns: {
          operation_id: string
          replayed: boolean
          source_id: string
          status: string
          universe_id: string
        }[]
      }
      create_draft_experiment: {
        Args: { p_name: string; p_objective: string; p_operation_id: string }
        Returns: string
      }
      event_revisions_as_of: {
        Args: { p_as_of: string }
        Returns: {
          author: string | null
          available_at: string
          content_hash: string
          correction_state: string
          created_at: string
          event_id: string
          first_seen_at: string
          id: string
          issuing_authority: string | null
          language: string
          licensing_metadata: Json
          owner_id: string
          provider_received_at: string | null
          published_at: string | null
          retention_until: string | null
          revision_no: number
          revision_of_id: string | null
          sanitized_text: string
          source_quality: number | null
          title: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'event_revisions'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      fail_manual_hosted_market_ingestion: {
        Args: {
          p_error_class: string
          p_latency_ms: number
          p_operation_id: string
        }
        Returns: {
          error_class: string
          finished_at: string
          ingestion_run_id: string
          operation_id: string
          records_inserted: number
          records_rejected: number
          records_reused: number
          records_seen: number
          replayed: boolean
          source_id: string
          status: string
        }[]
      }
      knowledge_chunks_as_of: {
        Args: { p_as_of: string }
        Returns: {
          available_at: string
          chunk_index: number
          content_hash: string
          created_at: string
          document_version_id: string
          embedding: string | null
          entities: Json
          id: string
          instrument_ids: string[]
          owner_id: string
          plain_text: string
          search_vector: unknown
          source_quality: number | null
          tags: string[]
          token_estimate: number
          valid_from: string
          valid_to: string | null
        }[]
        SetofOptions: {
          from: '*'
          to: 'knowledge_chunks'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      manual_hosted_market_ingestion_result: {
        Args: { p_operation_id: string }
        Returns: {
          error_class: string
          finished_at: string
          ingestion_run_id: string
          operation_id: string
          records_inserted: number
          records_rejected: number
          records_reused: number
          records_seen: number
          source_id: string
          started_at: string
          status: string
        }[]
      }
      hosted_official_calendar_state: {
        Args: never
        Returns: {
          calendar_year: number
          closed_session_count: number
          configured: boolean
          decision_at: string
          early_close_session_count: number
          exchange_count: number
          manifest_id: string | null
          manifest_record_id: string | null
          owner_id: string
          regular_session_count: number
          session_count: number
        }[]
      }
      hosted_experiment_start_readiness: {
        Args: { p_experiment_id: string }
        Returns: {
          calendar_manifest_id: string | null
          calendar_manifest_record_id: string | null
          control_state_version: string
          decision_at: string
          draft_ready: boolean
          draft_revision: string
          experiment_id: string
          market_manifest_id: string | null
          ready: boolean
          start_manifest_id: string
          universe_id: string | null
        }[]
      }
      hosted_manual_cycle_state: {
        Args: { p_experiment_id: string }
        Returns: {
          control_state_version: string
          decision_at: string
          experiment_id: string
          last_decision_at: string
          last_reason: string
          last_scheduler_run_id: string
          last_simulator_run_id: string
          last_slot_key: string
          last_status: string
          ready: boolean
          reason: string
          scheduler_provider: string
        }[]
      }
      market_instrument_snapshot_at: {
        Args: {
          p_decision_at: string
          p_instrument_ids: string[]
          p_source_ids: string[]
          p_timeframe: string
        }
        Returns: {
          active_from: string
          active_to: string
          ask_price_text: string
          ask_size_text: string
          asset_class: string
          bar_available_at: string
          bar_correction_state: string
          bar_end: string
          bar_first_seen_at: string
          bar_id: string
          bar_provider_event_at: string
          bar_provider_received_at: string
          bar_provider_record_key: string
          bar_revision_no: number
          bar_start: string
          bar_timeframe: string
          bid_price_text: string
          bid_size_text: string
          close_price_text: string
          currency: string
          decision_at: string
          exchange_id: string
          exchange_mic: string
          exchange_name: string
          exchange_timezone: string
          high_price_text: string
          instrument_id: string
          instrument_name: string
          is_shortable: boolean
          is_tradable: boolean
          low_price_text: string
          open_price_text: string
          owner_id: string
          price_increment_text: string
          quantity_increment_text: string
          quote_available_at: string
          quote_correction_state: string
          quote_first_seen_at: string
          quote_id: string
          quote_provider_event_at: string
          quote_provider_received_at: string
          quote_provider_record_key: string
          quote_revision_no: number
          source_code: string
          source_id: string
          source_is_enabled: boolean
          source_is_mock: boolean
          source_name: string
          source_provider: string
          source_type: string
          symbol: string
          volume_text: string
        }[]
      }
      market_feature_bars_at: {
        Args: {
          p_decision_at: string
          p_instrument_ids: string[]
          p_limit_per_feed?: number
          p_source_ids: string[]
          p_timeframe: string
        }
        Returns: {
          bar_available_at: string
          bar_correction_state: string
          bar_end: string
          bar_first_seen_at: string
          bar_id: string
          bar_provider_event_at: string
          bar_provider_received_at: string | null
          bar_provider_record_key: string
          bar_revision_no: number
          bar_start: string
          bar_timeframe: string
          close_price_text: string
          decision_at: string
          high_price_text: string
          instrument_id: string
          low_price_text: string
          open_price_text: string
          owner_id: string
          source_id: string
          volume_text: string
        }[]
      }
      market_quotes_as_of: {
        Args: { p_as_of: string; p_instrument_ids: string[] }
        Returns: {
          ask_price: number | null
          ask_size: number | null
          available_at: string
          bid_price: number | null
          bid_size: number | null
          content_hash: string
          correction_state: string
          first_seen_at: string
          id: string
          ingested_at: string
          instrument_id: string
          owner_id: string
          provider_event_at: string
          provider_received_at: string | null
          provider_record_key: string
          revision_no: number
          source_id: string
          supersedes_id: string | null
        }[]
        SetofOptions: {
          from: '*'
          to: 'market_quotes'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      market_sessions_at: {
        Args: {
          p_decision_at: string
          p_exchange_ids: string[]
          p_limit_per_exchange?: number
        }
        Returns: {
          calendar_source_code: string
          calendar_source_id: string
          calendar_source_name: string
          closes_at: string
          decision_at: string
          exchange_id: string
          exchange_mic: string
          exchange_name: string
          exchange_timezone: string
          opens_at: string
          owner_id: string
          session_available_at: string
          session_date: string
          session_id: string
          session_type: string
          source_identifier: string
        }[]
      }
      market_snapshot_read: {
        Args: { p_session_limit?: number; p_timeframe?: string }
        Returns: {
          decision_at: string
          feature_bar_rows: Json
          health_rows: Json
          instrument_rows: Json
          member_rows: Json
          owner_id: string
          session_rows: Json
          source_ids: string[]
          universe_row: Json
        }[]
      }
      market_snapshot_scope: {
        Args: never
        Returns: {
          decision_at: string
          member_rows: Json
          owner_id: string
          source_ids: string[]
          universe_row: Json
        }[]
      }
      market_source_health_at: {
        Args: { p_decision_at: string; p_source_ids: string[] }
        Returns: {
          checked_at: string
          decision_at: string
          error_class: string
          health_available_at: string
          health_id: string
          health_status: string
          last_success_at: string
          latency_ms: number
          owner_id: string
          source_code: string
          source_id: string
          source_is_enabled: boolean
          source_is_mock: boolean
          source_name: string
          source_provider: string
          source_type: string
        }[]
      }
      mutate_locked_experiment_lifecycle: {
        Args: {
          p_action: string
          p_clone_name?: string
          p_confirmation?: string
          p_expected_control_state_version: string
          p_experiment_id: string
          p_locked_version_id?: string
          p_operation_id: string
          p_reason?: string
        }
        Returns: {
          control_state_version: string
          execution_mode: string
          experiment_id: string
          lifecycle_status: string
          replayed: boolean
          source_experiment_id: string
        }[]
      }
      post_cash_ledger_entry: {
        Args: {
          p_amount: number
          p_correlation_id: string
          p_currency: string
          p_effective_at: string
          p_entry_type: string
          p_experiment_id: string
          p_idempotency_key: string
          p_metadata?: Json
          p_owner_id: string
          p_simulation_account_id: string
          p_source_component: string
          p_source_id: string
          p_source_type: string
        }
        Returns: string
      }
      reserve_ai_budget: {
        Args: {
          p_agent_run_id: string
          p_budget_policy_id: string
          p_call_kind: string
          p_experiment_id: string
          p_idempotency_key: string
          p_max_input_tokens: number
          p_max_output_tokens: number
          p_max_tool_calls: number
          p_owner_id: string
          p_pricing_id: string
          p_request_hash: string
          p_requested_at: string
        }
        Returns: Json
      }
      run_hosted_manual_cycle: {
        Args: {
          p_confirmation: string
          p_decision_at: string
          p_expected_control_state_version: string
          p_experiment_id: string
          p_operation_id: string
        }
        Returns: {
          decision_at: string
          model_calls: number
          paper_fills_created: number
          paper_orders_created: number
          reason: string
          replayed: boolean
          scheduler_run_id: string
          simulator_run_id: string
          slot_key: string
          status: string
        }[]
      }
      set_hosted_market_source_enabled: {
        Args: { p_enabled: boolean; p_operation_id: string }
        Returns: {
          effective_at: string
          enabled: boolean
          operation_id: string
          policy_id: string
          policy_version: number
          replayed: boolean
          source_id: string
          status: string
        }[]
      }
      start_hosted_draft_experiment: {
        Args: {
          p_confirmation: string
          p_expected_control_state_version: string
          p_expected_draft_revision: string
          p_experiment_id: string
          p_mode: string
          p_operation_id: string
        }
        Returns: {
          control_state_version: string
          execution_mode: string
          experiment_id: string
          experiment_version_id: string
          lifecycle_status: string
          replayed: boolean
          simulation_account_id: string
        }[]
      }
      settle_ai_budget: {
        Args: {
          p_cache_write_tokens: number
          p_cached_input_tokens: number
          p_finish_state: string
          p_input_tokens: number
          p_latency_ms: number
          p_output_tokens: number
          p_owner_id: string
          p_provider_response_id: string
          p_reasoning_tokens: number
          p_reservation_id: string
          p_tool_calls: number
          p_web_search_calls: number
        }
        Returns: Json
      }
      transition_ai_reservation: {
        Args: {
          p_owner_id: string
          p_reservation_id: string
          p_target_status: string
        }
        Returns: Json
      }
      update_draft_experiment: {
        Args: {
          p_expected_revision: string
          p_experiment_id: string
          p_name: string
          p_objective: string
          p_operation_id: string
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
