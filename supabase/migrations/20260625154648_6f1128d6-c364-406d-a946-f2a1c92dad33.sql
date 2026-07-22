
CREATE POLICY "Users read own vocals" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'vocals' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own vocals" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vocals' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own vocals" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'vocals' AND auth.uid()::text = (storage.foldername(name))[1]);
