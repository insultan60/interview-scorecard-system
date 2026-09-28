import React from 'react';

/**
 * RichTextViewer component cleanly renders formatted HTML content or plain text descriptions.
 */
export default function RichTextViewer({ content, className = '' }) {
  if (!content) {
    return <span className="text-muted-foreground italic">Not specified</span>;
  }

  // Check if content looks like HTML
  const isHtml = /<[a-z][\s\S]*>/i.test(content);

  if (isHtml) {
    return (
      <div
        className={`rich-text-content ${className}`}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  return (
    <div className={`whitespace-pre-wrap ${className}`}>
      {content}
    </div>
  );
}
