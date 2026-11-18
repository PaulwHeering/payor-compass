-- Separate Claude's note about a finding from the human reviewer's note, so a rejection reason
-- never overwrites the context Claude recorded.
alter table findings add column agent_note text;

-- Move notes written by the research agent out of reviewer_notes.
update findings
   set agent_note = reviewer_notes, reviewer_notes = null
 where reviewer_notes like 'Agent note:%' and status = 'pending';
