export type Role = 'admin' | 'coordinator' | 'volunteer';
export type EventType = 'friday' | 'bonfire' | 'other';
export type EventStatus = 'draft' | 'open' | 'closed' | 'completed' | 'cancelled';
/** 'pending_payment': started at a meeting with a fee and a payment link, not paid yet. Holds no place and is not counted. */
export type RegStatus = 'registered' | 'waitlisted' | 'cancelled' | 'pending_payment';
export type Attendance = 'unknown' | 'attended' | 'no_show';
/** none: a free meeting (or before fees); pending: owes the fee; waived: let in free; refunded: paid and given back. */
export type PaymentStatus = 'none' | 'pending' | 'paid' | 'waived' | 'refunded';
export type PaymentMethod = 'card' | 'bit' | 'paybox' | 'cash' | 'transfer' | 'other';
export type Engagement = 'registered' | 'first_timer' | 'returning' | 'regular' | 'lapsed';

export type Staff = {
  user_id: string;
  full_name: string;
  /** Sign-in by password (null for SMS-only accounts). */
  email: string | null;
  /** Sign-in by a one-time SMS code to this phone (E.164). */
  phone: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  created_at?: string;
  /** staff_me only: two-step sign-in is on, and the level this session reached ('aal2' = passed it). */
  mfa_enrolled?: boolean;
  aal?: string;
};

export type Site = { id: string; name: string; address: string | null; is_active: boolean; /** Code on the permanent entrance sign (#/s/…). */ checkin_code: string };

export type Source = { id: string; key: string; label: string; is_friend: boolean; asks_detail: boolean; sort_order: number; is_active: boolean };

export type Speaker = {
  id: string;
  kind: 'speaker' | 'instructor';
  full_name: string;
  topic: string | null;
  bio_line: string | null;
  /** The chip on the public meeting page ("מרצה אורחת"), up to 30 characters. */
  role_label: string | null;
  /** A few words for the public meeting page, up to 600 characters. */
  about: string | null;
  /** Object path of the photo in the public Storage bucket `people` (published only with the person's consent). */
  photo_path: string | null;
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
  /** Participation fee in ₪; null or 0 = free. */
  price: number | null;
  /** The provider's hosted payment page (https). Payment never happens in this app. */
  payment_url: string | null;
  payment_note: string | null;
  /** What the lecture is about, on the public meeting page; up to 600 characters. */
  lecture_description: string | null;
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

/** Membership in the association: not a member, asked to join, member. */
export type Membership = 'none' | 'requested' | 'member';

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
  membership: Membership;
  membership_requested_at: string | null;
  member_since: string | null;
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
  /** Set only by the database (staff_set_payment, staff_door_payment, the provider hook). */
  payment_status: PaymentStatus;
  paid_amount: number | null;
  paid_at: string | null;
  payment_method: PaymentMethod | null;
  payment_ref: string | null;
};

export type FollowUp = {
  id: string;
  participant_id: string;
  event_id: string | null;
  type: 'no_show' | 'first_time' | 'lapsed' | 'waitlist' | 'general' | 'membership' | 'payment';
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
  /** Only when the meeting has a fee (> 0); the link and note come with it. */
  price?: number | null;
  payment_url?: string | null;
  payment_note?: string | null;
  invited_by?: string | null;
  ref_source?: string | null;
  /** What the lecture is about (meeting details view). */
  lecture_description?: string | null;
  /** The approved instructor, then the approved speaker (meeting details view). */
  people?: PublicPerson[];
};

/** One person on the public meeting page. Only approved people; never a phone, notes or a social link. */
export type PublicPerson = {
  role: 'instructor' | 'speaker';
  name: string;
  /** role_label: the chip text, or null for the neutral default */
  label: string | null;
  /** bio_line: one short line on the card */
  line: string | null;
  about: string | null;
  /** object path in the public bucket `people` */
  photo_path: string | null;
};

// ── event preparation and volunteers (migration 20261106002200_event_prep.sql) ──
export type PrepCategory = 'venue' | 'program' | 'food' | 'equipment' | 'marketing' | 'registrations' | 'volunteers' | 'payments' | 'setup' | 'after' | 'general';
export type PrepKind = 'task' | 'equipment';
/** The standing checklist per kind of meeting. Due: `weekday` (0 = Sunday) of the week `week_offset` weeks from the
 *  meeting's week; with no weekday, the meeting day + `day_offset`. */
export type PrepTemplate = {
  id: string; event_type: EventType | 'all'; kind: PrepKind; category: PrepCategory; title: string;
  week_offset: number; weekday: number | null; day_offset: number; fixed_time: string | null; hours: number | null;
  notes: string | null; sort_order: number; is_active: boolean;
};
export type EventTask = {
  id: string; event_id: string; template_id: string | null; kind: PrepKind; category: PrepCategory; title: string;
  due_date: string | null; due_time: string | null; due_manual: boolean; hours: number | null; assignee_id: string | null;
  notes: string | null; sort_order: number; done_at: string | null; done_by: string | null; dismissed: boolean; created_at: string;
};
export type Supplier = {
  id: string; name: string; what: string | null; contact_name: string | null; phone: string | null; cost_note: string | null;
  notes: string | null; is_active: boolean;
};
export type EventPayment = {
  id: string; event_id: string; supplier_id: string | null; supplier: string; description: string | null; amount: number | null;
  due_date: string | null; invoice_received: boolean; paid_on: string | null; notes: string | null;
};
export type VolunteerRole = 'entrance' | 'food' | 'setup' | 'teardown' | 'photo' | 'other';
export type Volunteer = { id: string; full_name: string; phone: string | null; roles: VolunteerRole[]; notes: string | null; is_active: boolean; created_at: string };
export type ShiftStatus = 'invited' | 'confirmed' | 'declined' | 'cancelled';
export type VolunteerShift = {
  id: string; event_id: string; volunteer_id: string; role: VolunteerRole; status: ShiftStatus; responded_at: string | null; notes: string | null;
};
/** What a volunteer sees from their personal link (public_volunteer). */
export type PublicVolunteer = {
  first_name: string;
  shifts: { id: string; role: VolunteerRole; status: Exclude<ShiftStatus, 'cancelled'>; title: string; type: EventType; starts_at: string; ends_at: string; location: string | null }[];
};
