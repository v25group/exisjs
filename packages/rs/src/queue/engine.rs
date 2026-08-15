use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::{HashMap, BinaryHeap};
use std::cmp::Ordering;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, PartialEq)]
pub struct MemoryJob {
    pub id: String,
    pub payload_str: String,
    pub score: f64,
}

impl Eq for MemoryJob {}

// Custom ordering for BinaryHeap to act as a Min-Heap based on score
impl Ord for MemoryJob {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse ordering so lowest score is popped first
        other.score.partial_cmp(&self.score).unwrap_or(Ordering::Equal).then_with(|| self.id.cmp(&other.id))
    }
}

impl PartialOrd for MemoryJob {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Default)]
pub struct JobQueue {
    pending: BinaryHeap<MemoryJob>,
    processing: HashMap<String, MemoryJob>, // jobId -> Job
    dead_letter: HashMap<String, MemoryJob>,
}

#[napi]
pub struct NativeMemoryQueue {
    queues: Mutex<HashMap<String, JobQueue>>,
}

#[napi]
impl NativeMemoryQueue {
    #[napi(constructor)]
    pub fn new() -> Self {
        NativeMemoryQueue {
            queues: Mutex::new(HashMap::new()),
        }
    }

    #[napi]
    pub fn enqueue(
        &self,
        name: String,
        job_id: String,
        payload_str: String,
        score: f64,
        max_queue: Option<u32>,
    ) -> Result<String> {
        let mut queues = self.queues.lock().unwrap();
        let queue = queues.entry(name.clone()).or_insert_with(JobQueue::default);

        if let Some(max) = max_queue {
            if queue.pending.len() as u32 >= max {
                return Err(Error::new(
                    Status::GenericFailure,
                    format!("Queue backpressure activated: maximum queue size ({}) reached for job {}.", max, name),
                ));
            }
        }

        queue.pending.push(MemoryJob {
            id: job_id.clone(),
            payload_str,
            score,
        });

        Ok(job_id)
    }

    #[napi]
    pub fn poll(&self, job_names: Vec<String>, visibility_timeouts: Vec<u32>) -> Option<Vec<String>> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
        let mut queues = self.queues.lock().unwrap();

        for (i, name) in job_names.iter().enumerate() {
            if let Some(queue) = queues.get_mut(name) {
                // Peek at the min-heap
                let should_pop = if let Some(min_job) = queue.pending.peek() {
                    min_job.score <= now
                } else {
                    false
                };

                if should_pop {
                    if let Some(job) = queue.pending.pop() {
                        let visibility_timeout = visibility_timeouts.get(i).copied().unwrap_or(30000) as f64;
                        let processing_score = now + visibility_timeout;
                        
                        let processing_job = MemoryJob {
                            id: job.id.clone(),
                            payload_str: job.payload_str.clone(),
                            score: processing_score,
                        };
                        
                        queue.processing.insert(job.id.clone(), processing_job);
                        
                        return Some(vec![
                            format!("memory:{}:pending", name),
                            job.id,
                            job.payload_str,
                        ]);
                    }
                }
            }
        }

        None
    }

    #[napi]
    pub fn acknowledge(&self, name: String, job_id: String) {
        let mut queues = self.queues.lock().unwrap();
        if let Some(queue) = queues.get_mut(&name) {
            queue.processing.remove(&job_id);
        }
    }

    #[napi]
    pub fn fail(
        &self,
        name: String,
        job_id: String,
        payload_str: String,
        score_delay: f64,
        is_dead_letter: bool,
    ) {
        let mut queues = self.queues.lock().unwrap();
        if let Some(queue) = queues.get_mut(&name) {
            queue.processing.remove(&job_id);
            
            if is_dead_letter {
                queue.dead_letter.insert(
                    job_id.clone(),
                    MemoryJob {
                        id: job_id,
                        payload_str,
                        score: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64,
                    }
                );
            } else {
                queue.pending.push(MemoryJob {
                    id: job_id,
                    payload_str,
                    score: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64 + score_delay,
                });
            }
        }
    }

    #[napi]
    pub fn sweep(&self, job_names: Vec<String>) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as f64;
        let mut queues = self.queues.lock().unwrap();

        for name in job_names {
            if let Some(queue) = queues.get_mut(&name) {
                // Find all processing jobs whose score is <= now
                let mut expired = Vec::new();
                for (id, job) in &queue.processing {
                    if job.score <= now {
                        expired.push(id.clone());
                    }
                }

                for id in expired {
                    if let Some(job) = queue.processing.remove(&id) {
                        queue.pending.push(MemoryJob {
                            id: job.id,
                            payload_str: job.payload_str,
                            score: now,
                        });
                    }
                }
            }
        }
    }

    #[napi]
    pub fn close(&self) {
        let mut queues = self.queues.lock().unwrap();
        queues.clear();
    }
}
