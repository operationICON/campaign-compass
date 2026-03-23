INSERT INTO storage.buckets (id, name, public) VALUES ('model-avatars', 'model-avatars', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access for model avatars" ON storage.objects FOR SELECT USING (bucket_id = 'model-avatars');
CREATE POLICY "Public upload access for model avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'model-avatars');
CREATE POLICY "Public update access for model avatars" ON storage.objects FOR UPDATE USING (bucket_id = 'model-avatars');
CREATE POLICY "Public delete access for model avatars" ON storage.objects FOR DELETE USING (bucket_id = 'model-avatars');