-- =====================================================================
-- Your Space — seed (run AFTER creating the login user in
-- Authentication → Users → Add user → email cj.masujer@email.com,
-- the agreed password, "Auto confirm" ticked). The password is never
-- stored in this repo — it is typed only into the Supabase dashboard.
-- =====================================================================
do $$
declare
  v_owner uuid;
begin
  select id into v_owner from auth.users where email = 'cj.masujer@email.com';
  if v_owner is null then
    raise exception 'Create the auth user cj.masujer@email.com first (Authentication → Users → Add user)';
  end if;

  -- 1) lock the app to this one user (the login account; emails are SENT from the Gmail below)
  insert into private.app_owner (user_id) values (v_owner)
  on conflict (user_id) do nothing;

  -- 2) quota settings (₱25M quota, 150% goal = MacBook incentive, Nov 2026 – Feb 2027)
  insert into public.settings (owner_id, email_signature)
  values (v_owner, E'Best regards,\nCJ Masujer\nProperty Specialist | RLC Residences\ncjmasujer.rpmmc@gmail.com')
  on conflict (owner_id) do nothing;

  -- 3) shortcuts (all open in a new tab — these sites refuse to be embedded)
  --    TODO confirm with client: is 100079897745013 her personal account
  --    (then remove it — she asked for Messenger only, no feed) or a Page?
  insert into public.shortcuts (owner_id, label, url, category, sort_order) values
    (v_owner, 'Marketing Materials (Drive)', 'https://drive.google.com/drive/folders/1_pHR8PJ1tJgzyei2MAFvK_Atazn1P1aJ', 'Files',  10),
    (v_owner, 'Messenger (team chat)',       'https://www.messenger.com/',                                               'Comms',  20),
    (v_owner, 'Facebook — 100079897745013',  'https://www.facebook.com/profile.php?id=100079897745013',                  'Social', 30),
    (v_owner, 'Facebook Page — Your Space',  'https://www.facebook.com/profile.php?id=61596317363404',                   'Social', 31),
    (v_owner, 'Instagram — @yourspace.rpmmc','https://www.instagram.com/yourspace.rpmmc/',                               'Social', 40),
    (v_owner, 'TikTok — @yourspacerlc',      'https://www.tiktok.com/@yourspacerlc',                                     'Social', 50),
    (v_owner, 'Meta Business Suite 1',       'https://business.facebook.com/latest/home?business_id=1475541934473246&asset_id=105585465187043',  'Social', 60),
    (v_owner, 'Meta Business Suite 2',       'https://business.facebook.com/latest/home?business_id=4824108191155148&asset_id=1389454237595418', 'Social', 61),
    (v_owner, 'Salesforce',                  'https://rlcresidences.my.salesforce.com/',                                 'Sales',  70),
    (v_owner, 'RLC Sellers Portal',          'https://sellers.robinsonsland.com/',                                       'Sales',  80);

  -- 4) email templates carried over from the current Your Space app
  insert into public.email_templates (owner_id, name, subject, body, sort_order) values
    (v_owner, 'Introduction', 'RLC Residences | Your next home',
     'Hi! I’m CJ from RLC Residences. I’d love to help you find a home that fits your budget. May I send you our available units and payment options?', 10),
    (v_owner, 'LTO 120 overview', 'Lease-to-Own 120 | Own a home through monthly rent',
     E'Hi! Here’s a quick look at Lease-to-Own 120 at RLC Residences:\n\n• A 10-year (120-month) lease with a fixed monthly rent\n• Monthly rent = Net Total Contract Price ÷ 120\n• Your full monthly rent is credited toward owning your home\n• No reservation fee\n• Rent is exclusive of condo dues\n\nTerms and conditions apply. Would you like a sample computation for a unit you like?', 20),
    (v_owner, 'LTO 120: how it works', 'How Lease-to-Own 120 works',
     E'Hi! Here’s how Lease-to-Own 120 works, step by step:\n\n1. Choose your unit.\n2. Prepare the booking and move-in requirements: the applicable rent, security deposit, condo dues and post-dated checks. There is no reservation fee.\n3. Move in and pay your fixed monthly rent for 10 years (120 months).\n4. Every peso of rent is credited toward the price of your home.\n5. After the lease term, your payments are complete and you can own the unit.\n\nCondo dues are paid separately and are not credited. I can send you a personalized computation anytime.', 30),
    (v_owner, 'LTO 120: questions answered', 'Lease-to-Own 120: your questions answered',
     E'Hi! Common questions about Lease-to-Own 120:\n\nIs there a reservation fee? No.\nHow is the rent computed? Net Total Contract Price ÷ 120 months.\nIs the rent credited to my purchase? Yes, in full.\nDoes the rent include condo dues? No, dues are separate and not credited.\nHow long is the lease? 10 years.\n\nTerms and conditions apply. Shall I prepare a sample quotation for you?', 40),
    (v_owner, 'Quotation follow-up', 'Your Lease-to-Own 120 computation',
     'Hi! Following up on the sample Lease-to-Own 120 computation I prepared for you. Do you have questions, or would you like to see the unit in person? I can arrange a viewing at your convenience.', 50),
    (v_owner, 'Viewing invite', 'Invitation to a viewing',
     'Hi! I’d like to invite you to view the unit. What day and time work for you?', 60)
  on conflict (owner_id, name) do nothing;
end $$;
