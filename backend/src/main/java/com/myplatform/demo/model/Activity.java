package com.myplatform.demo.model;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class Activity {
    String industryCode;
    List<String> salesChannels;
    String id;
}
