import { useEffect, useRef, useState } from 'react';
import { Timeline as VisTimeline } from 'vis-timeline/standalone';
import { DataSet } from 'vis-data/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';

interface MeetingItem {
  id: string;
  title: string;
  date: string;
  summary: string;
}

interface Props {
  meetings: MeetingItem[];
}

interface TimelineItemData {
  id: number;
  group: number;
  content: string;
  start: string;
  title: string;
  meetingId: string;
}

export default function Timeline({ meetings }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<TimelineItemData[]>([]);
  const timelineRef = useRef<VisTimeline | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || meetings.length === 0) return;

    // ── Build dataset ──
    const items: TimelineItemData[] = meetings.map((m, i) => ({
      id: i,
      group: 0,
      content: m.title,
      start: m.date,
      title: `${m.date}\n${m.title}\n${m.summary.slice(0, 80)}${m.summary.length > 80 ? '…' : ''}`,
      meetingId: m.id,
    }));
    itemsRef.current = items;

    const ds = new DataSet(items);

    // ── Initialize timeline ──
    const tl = new VisTimeline(containerRef.current, ds, {
      stack: true,
      stackSubgroups: false,
      showCurrentTime: true,
      zoomMin: 1000 * 60 * 60 * 24 * 7, // 1 week
      zoomMax: 1000 * 60 * 60 * 24 * 365 * 2, // 2 years
      margin: { item: { vertical: 6 } },
      tooltip: {
        followMouse: true,
        overflowMethod: 'flip',
        delay: 200,
      },
    });

    timelineRef.current = tl;

    // ── Click → navigate ──
    tl.on('click', (props: { item?: number }) => {
      if (props.item === undefined || props.item === null) return;
      const found = itemsRef.current.find((it) => it.id === props.item);
      if (found?.meetingId) {
        window.location.href = `/meeting/${found.meetingId}`;
      }
    });

    setReady(true);

    return () => {
      tl.destroy();
      timelineRef.current = null;
    };
  }, [meetings]);

  return (
    <div className="timeline-wrapper">
      <div ref={containerRef} className="timeline-container" />
      {ready && (
        <div className="timeline-status">
          {meetings.length} 场会议
        </div>
      )}
    </div>
  );
}
