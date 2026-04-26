import React from 'react';
import type { Attachment } from '../types/messages';
import styles from './Attachment.module.css';

export function Attachment({ attachment }: { attachment: Attachment }) {
  const getFileUrl = (key: string) => `http://localhost:8000/api/v1/files/${key}`;
  const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;

  if (attachment.file_type === 'image') {
    return (
      <div className={styles.imageWrap}>
        <img 
          src={getFileUrl(attachment.thumbnail_key || attachment.file_key)} 
          alt={attachment.filename}
          className={styles.previewImg}
          onClick={() => window.open(getFileUrl(attachment.file_key), '_blank')}
        />
        <span className={styles.fileName}>{attachment.filename}</span>
      </div>
    );
  }

  return (
    <a href={getFileUrl(attachment.file_key)} target="_blank" rel="noopener" className={styles.fileLink}>
      <span className={styles.fileIcon}>
        {attachment.file_type === 'document' ? '📄' : attachment.file_type === 'audio' ? '🎵' : '📎'}
      </span>
      <div className={styles.fileMeta}>
        <span className={styles.fileName}>{attachment.filename}</span>
        <span className={styles.fileSize}>{formatSize(attachment.file_size)}</span>
      </div>
    </a>
  );
}