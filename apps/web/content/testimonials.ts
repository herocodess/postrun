/**
 * Testimonials shown on the home page, between Security and the FAQ.
 *
 * Every entry must be a real quote, given by the named person, with their
 * permission to publish it with their name, role and company. Do not add
 * example, paraphrased or placeholder quotes. While this list is empty the
 * section does not render at all.
 */

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
  /** Must be true: the person agreed to this exact quote being published. */
  permission: true;
}

export const TESTIMONIALS: Testimonial[] = [];
