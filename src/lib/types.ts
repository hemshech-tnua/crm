export type Role = 'admin' | 'coordinator' | 'volunteer';
export type EventType = 'friday' | 'bonfire' | 'other';
export type EventStatus = 'draft' | 'open' | 'closed' | 'completed' | 'cancelled';
export type RegStatus = 'registered' | 'waitlisted' | 'cancelled';
export type Attendance = 'unknown' | 'attended' | 'no_show';
export type Engagement = 'registered' | 'first_timer' | 'returning' | 'regular' | 'lapsed';

export type Staff = {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at?: string;
};

export type Site = { id: string; name: string; address: string | null; is_active: boolean };

export type Source = { id: string; key: string; label: string; is_friend: boolean; asks_detail: boolean; sort_order: number; is_active: boolean };

export type Speaker = {
  id: string;
  kind: 'speaker' | 'instructor';
  full_name: string;
  topic: string | null;
  bio_line: string | null;
  phone: string | null;
  social_url: string | null;
  status: 'proposed' | 'approved' | 'declined' | 'archived';
  source: 'staff' | 'public_form';
  proposal_message: string | null;
  notes: string | null;
  approved_at: string | null;
  created_at: string;
};

export type EventRow = {
  id: string;
  site_id: string;
  type: EventType;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  description: string | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  status: EventStatus;
  registration_closes_at: string | null;
  speaker_id: string | null;
  lecture_topic: string | null;
  instructor_id: string | null;
  activity_name: string | null;
  public_code: string;
  checkin_code: string;
  cancel_reason: string | null;
  internal_notes: string | null;
  completed_at: string | null;
  created_at: string;
};

export type EventStats = {
  event_id: string;
  registered_count: number;
  waitlisted_count: number;
  cancelled_count: number;
  attended_count: number;
  walk_in_count: number;
  no_show_count: number;
  attended_registered_count: number;
  new_count: number;
  returning_count: number;
  self_checkin_count: number;
  feedback_count: number;
  avg_overall: number | null;
  avg_activity: number | null;
  avg_lecture: number | null;
};

export type Participant = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  birth_year: number | null;
  birth_date: string | null;
  occupation: string | null;
  first_source_id: string | null;
  first_source_detail: string | null;
  referred_by_participant_id: string | null;
  referred_by_name: string | null;
  referral_code: string;
  consent_updates: boolean;
  consent_updates_at: string | null;
  photo_opt_out: boolean;
  notes: string | null;
  created_via: string;
  anonymized_at: string | null;
  created_at: string;
};

export type ParticipantStats = {
  participant_id: string;
  attended_count: number;
  friday_count: number;
  bonfire_count: number;
  first_attended_at: string | null;
  last_attended_at: string | null;
  last_friday_at: string | null;
  registrations_count: number;
  no_show_count: number;
  cancel_count: number;
  last_registered_at: string | null;
  feedback_count: number;
  avg_rating_given: number | null;
  friends_brought: number;
  ever_regular: boolean;
  is_regular: boolean;
  fridays_missed: number;
  engagement_status: Engagement;
};

export type Registration = {
  id: string;
  event_id: string;
  participant_id: string;
  status: RegStatus;
  attendance: Attendance;
  is_walk_in: boolean;
  registered_at: string;
  promoted_at: string | null;
  cancelled_at: string | null;
  cancelled_by: 'participant' | 'staff' | null;
  cancel_reason: string | null;
  checked_in_at: string | null;
  checkin_method: 'self_qr' | 'staff' | null;
  how_heard_source_id: string | null;
  how_heard_detail: string | null;
  referrer_participant_id: string | null;
  referrer_name: string | null;
  referral_link_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  submitted_name: string | null;
  created_via: string;
};

export type FollowUp = {
  id: string;
  participant_id: string;
  event_id: string | null;
  type: 'no_show' | 'first_time' | 'lapsed' | 'waitlist' | 'general';
  title: string;
  notes: string | null;
  due_date: string | null;
  assignee_id: string | null;
  status: 'open' | 'done' | 'cancelled';
  outcome: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ContactLog = {
  id: string;
  participant_id: string;
  channel: 'whatsapp' | 'phone' | 'in_person' | 'other';
  template_key: string | null;
  summary: string | null;
  event_id: string | null;
  follow_up_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type Feedback = {
  id: string;
  event_id: string;
  registration_id: string | null;
  participant_id: string | null;
  overall_rating: number;
  activity_rating: number | null;
  lecture_rating: number | null;
  comment: string | null;
  source: string;
  created_at: string;
};

export type Template = {
  key: string;
  label: string;
  body: string;
  audience: 'registered' | 'waitlisted' | 'attended' | 'no_show' | 'consented' | 'participant';
  is_marketing: boolean;
  sort_order: number;
};

export type ReferralLink = {
  id: string;
  code: string;
  label: string;
  source_id: string | null;
  campaign: string | null;
  is_active: boolean;
  created_at: string;
};

export type Settings = {
  org_name: string;
  default_site_id: string | null;
  default_capacity: number | null;
  regular_min_fridays: number;
  regular_window_days: number;
  lapsed_after_fridays: number;
  goal_avg_attendance: number;
  goal_show_rate: number;
  goal_return_rate: number;
  goal_friend_share: number;
  goal_avg_rating: number;
  auto_task_no_show: boolean;
  auto_task_first_time: boolean;
  auto_task_lapsed: boolean;
  default_task_assignee: string | null;
  checkin_opens_minutes: number;
  checkin_closes_minutes: number;
  feedback_days: number;
  retention_months: number;
  consent_text_version: string;
  contact_phone: string | null;
};

/** What a visitor sees about an event (public_get_event). */
export type PublicEvent = {
  code: string;
  title: string;
  type: EventType;
  starts_at: string;
  ends_at: string;
  location: string | null;
  site_name: string;
  description: string | null;
  activity_name: string | null;
  instructor_name: string | null;
  speaker_name: string | null;
  speaker_bio: string | null;
  lecture_topic: string | null;
  status: EventStatus;
  registration_open: boolean;
  is_full: boolean;
  spots_left: number | null;
  waitlist_enabled: boolean;
  invited_by?: string | null;
  ref_source?: string | null;
};
